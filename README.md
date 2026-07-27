# ink

An inbox nobody but you can read, not even the server holding it.

You publish a link. Anyone opens it with no account, no key exchange and no install,
types a secret, and their browser seals it to a key only you hold. ink stores a blob it
has no way to open.

## Why this instead of the other ones

Every tool in this space is sender-initiated: the person who has to care about security
is the one being asked to find the tool, and they paste into Slack instead. ink flips
it. The receiver, who does care, hands out a link. The sender sees a box.

The second difference is the format. Onetimesecret, Bitwarden Send, SendSafely and the
rest each produce a proprietary blob locked to the vendor. ink produces an **age file**:

```sh
curl -H "x-ink-token: $TOKEN" https://ink.example/api/inbox/acme/submission/$ID \
  | age -d -i identity.txt
```

That works with the stock `age` CLI, on a machine that has never heard of ink, ten
years after this service is switched off. It is the one claim here a competitor cannot
copy without abandoning their storage layer, and `test/interop.test.ts` proves it by
running the real binary against real stored bytes.

## Quickstart

```sh
bun install
bun run dev          # http://localhost:8787
```

Creating an inbox asks three things: an address, what you are asking for, and how you
want to unlock it (a passkey or a passphrase). Everything else has a default and lives
under **Advanced**.

It then hands you three things:

| | |
|---|---|
| a submit link | `…/i/acme#age1…` give this out, the key rides in the fragment |
| a manage link | `…/i/acme/manage#<token>` keep this, it lists and decrypts |
| a key file | the only copy outside your unlock method, and what `age -d -i` wants |

The fragment never reaches the server. That is deliberate: it means ink cannot swap in
a key it holds the identity for. If a link arrives stripped of its fragment, the submit
page refuses to send until someone explicitly accepts the downgrade.

Under Advanced you can pick the key type:

| kind | recipient | notes |
|---|---|---|
| X25519 | 62 chars | the age default, a link short enough to paste anywhere |
| post-quantum hybrid | 1959 chars | ML-KEM-768 + X25519, needs `age` 1.3 or newer to decrypt |

Both are native age, both are what `age-keygen` produces (plain and `-pq`), and both
round trip through the stock CLI in either direction. `test/interop.test.ts` proves it
for each.

## Unlocking

The key is generated in your browser and then wrapped, once per method you choose:

- **a passkey**, held by your device or password manager, nothing to remember
- **a passphrase**, which works everywhere and is only as strong as you make it

Both wrap the same key, so either opens the inbox. Add a passkey for a second device
later, remove one you have lost, and the key never changes. The last method cannot be
removed, because that would make every submission unreadable forever.

A passkey cannot be the recipient itself, incidentally: WebAuthn PRF is symmetric, so a
stranger would have nothing to encrypt *to*. It seals a copy of the key instead. That
also means deleting the passkey costs you one unlock method, not the inbox.

## Forms and files

An inbox can ask for specific things instead of offering one box: a masked secret, a
few lines of text, a file upload, each labelled by you and optionally required. Leave
the list empty and it stays a single free-text box.

Everything a sender fills in becomes **one tar, then one age file**. That is the whole
reason for the format choice: what you get back is real files with real names.

```sh
age -d -i identity.txt < submission.age | tar -x
# 01-aws-access-key.txt  02-notes.txt  03-signed-contract.pdf
```

A JSON envelope with base64 blobs would have been easier to write and useless at
exactly the moment it matters.

Two things to be clear about:

**Field labels are stored in the clear.** The submit page has to render them and the
sender has no key, so it cannot be otherwise. That is the same exposure the title
already has. ink hides what people send, not what you asked for. Values are never in
the clear, anywhere.

**`required` is a courtesy to the sender, not a guarantee to you.** The server cannot
check a value it cannot read, so the browser enforces it and an unusual client could
ignore it.

## Subdomains

Set `INK_DOMAIN` (or the `INK_DOMAIN` var on Workers) and every inbox gets its own
origin: `acme.uses.ink` is the submit page, `acme.uses.ink/manage` reads it, and the
apex is where inboxes are created. Without it, everything stays on paths and nothing
changes, which is what local development and preview deployments use.

Separate origins are worth more than the tidy URL: a passkey enrolled for one inbox is
scoped to that host by the browser, so it cannot be used against another, and neither
can anything else keyed by origin. Reserved labels (`www`, `mail`, `ns1`, `api` and
friends) are refused so an inbox can never shadow infrastructure on the same domain.

## Managing an inbox

The manage link lists what arrived and decrypts it in your tab. From there you can
delete a single submission, add a passkey, stop accepting new submissions (reversible,
and what a closed inbox tells a sender), mint a new manage link (which invalidates the
old one, the only way to revoke a leaked link), or delete the inbox and everything in
it.

**Export all** writes every submission to one tar, still sealed, alongside a README
saying how to open it. It is deliberately ciphertext rather than plaintext: dropping
every secret into a downloads folder would undo the only thing this does, and the
archive still opens with `age -d -i identity.txt` on any machine, with or without ink.
On a destroy-on-read inbox it asks first, because exporting reads.

Every inbox has a retention period, set when you create it and defaulting to **7 days**.
Expiry is enforced when a submission is read, not by a cron, so a lapsed secret is
unreadable even if no sweep has run; the bytes go on the next write to that inbox.
**Destroy on read** is available too: the submission is deleted the moment you open it.

## From a terminal

`bin/ink` is one POSIX shell script covering every operation the pages offer, over the
same API, without running any of their JavaScript. That is the point rather than a
convenience: the browser gets its code from the server it is protecting you from. It is
served from the apex, so there is nothing to clone:

```sh
curl -fsSL https://uses.ink/ink -o ink && chmod +x ink
```

| | |
|---|---|
| `ink new <address> <title>` | generates a key, wraps it with a passphrase, prints all three links |
| `ink send <submit-link> [file…]` | seals and posts; reads stdin when given no files |
| `ink list <manage-link>` | what has arrived |
| `ink read <manage-link> <id> [dir]` | decrypts one submission into `dir` |
| `ink export <manage-link> [out.tar]` | every submission, still sealed |
| `ink rm` / `close` / `open` / `rotate` / `destroy` | the rest of the manage page |

It needs `curl`, `age`, `tar` and `jq`. Links carry their secret after the `#`, so quote
them or the shell eats it. `--json` puts the raw response on stdout while logs stay on
stderr, so it pipes into `jq`; `-y` skips confirmation on the destructive commands, and
absent a terminal they refuse rather than assume yes.

## Limits

Anyone holding the submit link can write to that inbox, because that is the product.
So each submission is capped at 10MB, and each inbox at 500 submissions and 100MB.
Hitting a bound refuses new submissions with a `submission.quota` diagnostic and leaves
everything already stored readable. Per-IP rate limiting is not in the app: put it at
the edge, where it belongs.

Passphrases have a 12 character floor and the page will generate a strong one. It is
the only thing protecting your key if the manage link ever leaks.

## What it does not do yet

- No notifications. Nothing tells you a secret arrived; you have to open the link.
- One file per field, and no drag-and-drop. A form asks for what it asks for.
- The manage token guards metadata, never plaintext. It can be rotated, which is the
  only way to revoke a leaked manage link.
- Lose every unlock method and the key file, and every submission is gone. There is no
  recovery, by construction.

## The honest caveat

Ciphertext at rest is unreadable to the server, and that is provable. But the sender
runs JavaScript the server delivered, so a malicious build could exfiltrate before
encrypting. This is the unsolved weakness of all browser E2EE, Proton and Bitwarden
included.

The complete answer is to not run our code at all. Every submit page prints the
equivalent terminal command:

```sh
printf %s 'YOUR SECRET' \
  | age -e -r age1... \
  | curl -s --data-binary @- \
      -H 'content-type: application/octet-stream' \
      https://ink.example/api/inbox/acme/submission
```

Or use the script, which does every operation the pages do and never loads them:

```sh
curl -fsSL https://uses.ink/ink -o ink && chmod +x ink
./ink new acme 'Client credentials'
```

That works because ink stores an age file, not a private blob format. Short of that:
the crypto surface is a framework-free bundle, the build is byte-for-byte deterministic,
every run prints an SRI hash, and each page pins its script by that hash, so what is
served can be compared against what was published.

What none of that establishes is that the published build came from this source. That
needs someone else rebuilding it. The build is deterministic precisely so they can.

## Layout

```
src/core     shared by both planes: routes, diagnostics, value types
src/web      the crypto surface, one bundle per page, no framework
src/serve    routing, HTML, cache policy
src/store    typed tables, literal migrations
src/blob     ciphertext storage, R2 or filesystem or memory
src/host     local (Bun, bun:sqlite) and workers (D1, R2)
bin/ink      the terminal client, copied to public/ink at build time
test/        YAML scenarios plus their runners in test/harness
bench/       percentile benchmarks
```

## Commands

```sh
bun run check     # typecheck + lint + test
bun run dev       # local host, http://localhost:8787
bun run dev:cf    # wrangler, against D1 and R2
bun run bench
```

`test/interop.test.ts` needs the `age` binary and skips without it:

```sh
go install filippo.io/age/cmd/age@latest
```

Conventions and the reasoning behind the design are in [AGENTS.md](./AGENTS.md).
