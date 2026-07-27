import * as age from 'age-encryption';
import { Passphrase } from '../core/passphrase.ts';
import type { Unlock } from '../core/unlock.ts';
import { Fault } from './fault.ts';

/**
 * Wraps and unwraps the master identity, once per unlock method.
 *
 * A passkey cannot be the recipient: WebAuthn PRF is symmetric, so a stranger
 * has nothing to encrypt to. It seals a copy of the identity instead, which is
 * also what keeps deleting a passkey from destroying the inbox.
 */
export class Keyring {
  static readonly KEY_NAME = 'ink inbox key';

  static supported(): boolean {
    return typeof PublicKeyCredential === 'function' && globalThis.isSecureContext;
  }

  static async byPassphrase(identity: string, passphrase: string): Promise<Keyring.Made> {
    if (Passphrase.weak(passphrase)) {
      throw Fault.of(
        'passphrase.weak',
        'passphrase too short',
        `a passphrase must be at least ${Passphrase.MIN} characters`,
        'this is the only thing protecting your key if the manage link ever leaks',
      );
    }

    const encrypter = new age.Encrypter();
    encrypter.setPassphrase(passphrase);
    return { kind: 'passphrase', label: 'passphrase', wrapped: await Keyring.seal(encrypter, identity) };
  }

  /**
   * Enrolls a credential and seals the identity to it. `security-key` is not
   * used: passkeys sync through the platform keychain, and a hardware-bound
   * credential that cannot be regenerated is a way to lose an inbox.
   */
  static async byPasskey(identity: string, label: string): Promise<Keyring.Made> {
    if (!Keyring.supported()) throw Keyring.unsupported();

    const credential = await Keyring.enrol();
    const encrypter = new age.Encrypter();
    encrypter.addRecipient(new age.webauthn.WebAuthnRecipient({ identity: credential }));

    return {
      kind: 'passkey',
      label,
      credential,
      wrapped: await Keyring.seal(encrypter, identity),
    };
  }

  /** Opens whichever wrapping the owner chose, and returns the identity. */
  static async open(wrapping: Keyring.Stored, passphrase?: string): Promise<string> {
    const decrypter = new age.Decrypter();

    if (wrapping.kind === 'passkey') {
      if (!Keyring.supported()) throw Keyring.unsupported();
      decrypter.addIdentity(
        new age.webauthn.WebAuthnIdentity(wrapping.credential ? { identity: wrapping.credential } : {}),
      );
    } else {
      if (!passphrase) {
        throw Fault.of('passphrase.missing', 'passphrase needed', 'type the passphrase for this inbox');
      }
      decrypter.addPassphrase(passphrase);
    }

    try {
      return await decrypter.decrypt(age.armor.decode(wrapping.armored), 'text');
    } catch (cause) {
      throw Keyring.refused(wrapping, cause);
    }
  }

  private static async enrol(): Promise<string> {
    try {
      return await age.webauthn.createCredential({ keyName: Keyring.KEY_NAME, type: 'passkey' });
    } catch (cause) {
      throw Fault.of(
        'passkey.unavailable',
        'passkey not available',
        'this device or browser would not create a passkey ink can encrypt with',
        'it needs the WebAuthn PRF extension, which some platforms still lack',
        cause instanceof Error ? cause.message : 'use a passphrase instead',
      );
    }
  }

  private static async seal(encrypter: age.Encrypter, identity: string): Promise<string> {
    return age.armor.encode(await encrypter.encrypt(identity));
  }

  private static unsupported(): Fault {
    return Fault.of(
      'passkey.unsupported',
      'passkeys unavailable here',
      'this browser has no WebAuthn, or the page is not on a secure origin',
      'use a passphrase instead',
    );
  }

  private static refused(wrapping: Keyring.Stored, cause: unknown): Fault {
    const why =
      wrapping.kind === 'passkey'
        ? 'the passkey did not unlock this inbox, it may be a different one'
        : 'that passphrase did not unlock this inbox';
    return Fault.of('unlock.refused', 'could not unlock', why, cause instanceof Error ? cause.message : '');
  }
}

export namespace Keyring {
  export interface Made {
    readonly kind: Unlock.Kind;
    readonly label: string;
    readonly wrapped: string;
    readonly credential?: string;
  }

  export interface Stored {
    readonly id: string;
    readonly kind: Unlock.Kind;
    readonly label: string;
    readonly credential: string | null;
    readonly armored: string;
    readonly createdAt: number;
  }
}
