import { describe, expect, test } from 'bun:test';
import { Suite } from './harness/suite.ts';
import { type Owner, World } from './harness/world.ts';

interface Scenario {
  readonly name: string;
  readonly inbox: World.New;
  readonly steps: readonly Step[];
}

interface Step {
  readonly act: 'submit' | 'list' | 'read' | 'key';
  readonly text?: string;
  readonly bytes?: number;
  readonly at?: number;
  readonly count?: number;
  readonly read?: boolean;
  readonly token?: string;
  readonly status?: number;
  readonly code?: string;
}

/** Interprets one scenario file against a fresh world. */
class Run {
  private listing: Owner.View[] = [];

  constructor(private readonly owner: Owner) {}

  async step(step: Step): Promise<void> {
    switch (step.act) {
      case 'submit':
        return this.submit(step);
      case 'list':
        return this.list(step);
      case 'read':
        return this.read(step);
      case 'key':
        return this.key(step);
    }
  }

  private async submit(step: Step): Promise<void> {
    const response =
      step.bytes === undefined
        ? await this.owner.submit(step.text ?? '')
        : await this.owner.post(new Uint8Array(step.bytes));
    await Run.expect(response, step, 201);
  }

  private async list(step: Step): Promise<void> {
    const response = await this.owner.listed(step.token);
    if (await Run.expect(response, step, 200)) return;

    const body = (await response.json()) as { submissions: Owner.View[] };
    this.listing = body.submissions;
    if (step.count !== undefined) expect(this.listing.length).toBe(step.count);
    if (step.read !== undefined) {
      for (const view of this.listing) expect(view.readAt !== null).toBe(step.read);
    }
  }

  private async read(step: Step): Promise<void> {
    if (this.listing.length === 0) this.listing = await this.owner.list();
    const view = this.listing[step.at ?? 0];
    if (!view) throw new Error(`no submission at index ${step.at ?? 0}`);
    expect(await this.owner.read(view.id)).toBe(step.text ?? '');
    this.listing = [];
  }

  private async key(step: Step): Promise<void> {
    const response = await this.owner.keyed(step.token);
    await Run.expect(response, step, 200);
  }

  /** Returns true when the step asserted a refusal, so the caller stops. */
  private static async expect(response: Response, step: Step, ok: number): Promise<boolean> {
    expect(response.status).toBe(step.status ?? ok);
    if (step.code === undefined) return response.status !== (step.status ?? ok);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(step.code);
    return true;
  }
}

for (const suite of await Suite.all<Scenario>(`${import.meta.dir}/cases`)) {
  describe(`cases/${suite.name}`, () => {
    test(suite.data.name, async () => {
      const world = await World.make();
      const run = new Run(await world.open(suite.data.inbox));
      for (const step of suite.data.steps) await run.step(step);
    });
  });
}
