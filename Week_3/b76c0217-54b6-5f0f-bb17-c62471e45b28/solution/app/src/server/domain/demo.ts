// The demo workspace created when the database has no teams.

import { db, one } from '../db';
import { seedWorkspace, type SeedBody } from './seed';

const INTRODUCTION = `## What Quire does

Quire turns a folder of notes into a published handbook. You write in plain text, arrange pages in a sidebar and publish when every link checks out.

<Callout type="tip">
Start with the [install guide](/guides/install#requirements), then come back here.
</Callout>

## Getting set up

<Steps>
<Step title="Install the app">
Follow [Install](/guides/install) for your platform.
</Step>
<Step title="Configure your workspace">
Open [Configure](/guides/configure) and give the handbook a name.
</Step>
<Step title="Publish">
Read [Publishing](/guides/publish#checks) before you ship.
</Step>
</Steps>

## Pick your platform

<Tabs>
<Tab title="Linux">
Quire runs on current Ubuntu and Fedora releases.
</Tab>
<Tab title="macOS">
Quire runs on macOS 13 and later, on Apple silicon and Intel.
</Tab>
</Tabs>

<CodeGroup>
\`\`\`bash Shell
quire init handbook
\`\`\`
\`\`\`js JavaScript
import { init } from 'quire';

init('handbook');
\`\`\`
</CodeGroup>

<Accordion title="Does Quire need an account?">
No. Quire works on files in a folder. An account is only needed to share a handbook with your team.
</Accordion>

## Next steps

<Cards>
<Card title="Install" href="/guides/install">
Requirements and the first run.
</Card>
<Card title="Publishing" href="/guides/publish">
Checks, previews and going live.
</Card>
</Cards>
`;

const INSTALL = `## Requirements

Quire runs on Linux and macOS. It needs 200 MB of disk space and a recent terminal.

## Installing

Download the archive for your platform, unpack it and run \`quire init\`. The command creates a \`quire.toml\` file next to your notes.

## First run

Run \`quire serve\` to see the handbook on your own machine before you publish anything.
`;

const CONFIGURE = `## Settings

All settings live in \`quire.toml\`. The file is plain text and safe to commit.

## Environment

Quire reads \`QUIRE_HOME\` for its cache folder. Everything else is a setting in the file.
`;

const PUBLISH = `## Previews

Share a draft page before it goes live. A preview link shows one page and expires on its own.

## Checks

Publishing is refused while a link, an anchor or a component is broken. Fix the listed problems, then publish again.
`;

const CLI = `## Commands

\`quire init\` creates a handbook, \`quire serve\` previews it and \`quire publish\` ships it.

## Flags

Pass \`--port\` to \`quire serve\` to change the preview port.
`;

const THEMES = `## Light and dark

Handbooks follow the reader's system setting by default.

## Palettes

Pick a palette in \`quire.toml\`. Every palette is checked for contrast.
`;

const version = (slug: string, title: string, isDefault: boolean, extra: boolean): SeedBody['sites'][0]['versions'][0] => ({
  slug,
  title,
  default: isDefault,
  published: true,
  tabs: [
    {
      title: 'Guides',
      groups: [
        {
          title: 'Getting started',
          pages: [
            { path: 'introduction', title: 'Introduction', source: INTRODUCTION },
            { path: 'guides/install', title: 'Install', source: INSTALL },
            { path: 'guides/configure', title: 'Configure', source: CONFIGURE },
            ...(extra ? [{ path: 'guides/themes', title: 'Themes', source: THEMES }] : []),
          ],
        },
        { title: 'Publishing', pages: [{ path: 'guides/publish', title: 'Publishing', source: PUBLISH }] },
      ],
    },
    { title: 'Reference', groups: [{ title: 'CLI', pages: [{ path: 'reference/cli', title: 'CLI', source: CLI }] }] },
  ],
  redirects: extra ? [{ from: '/setup', to: '/guides/install', kind: 'auto' }] : [],
});

const DEMO: SeedBody = {
  users: [
    { key: 'owner', email: 'ines@quire.test', name: 'Ines Varga', password: 'quire-owner-2026' },
    { key: 'editor', email: 'dara@quire.test', name: 'Dara Okafor', password: 'quire-editor-2026' },
    { key: 'viewer', email: 'lev@quire.test', name: 'Lev Marsh', password: 'quire-viewer-2026' },
  ],
  team: {
    name: 'Quire Labs',
    members: [
      { user: 'owner', role: 'owner' },
      { user: 'editor', role: 'editor' },
      { user: 'viewer', role: 'viewer' },
    ],
  },
  sites: [
    {
      slug: 'quire',
      title: 'Quire Docs',
      versions: [version('v1', 'Version 1', false, false), version('v2', 'Version 2', true, true)],
      ratings: [{ version: 'v2', path: 'introduction', yes: 7, no: 2 }],
      searchTerms: [{ version: 'v2', term: 'install', searches: 5, results: 3 }],
    },
  ],
};

export async function seedDemoIfEmpty(): Promise<void> {
  if ((await one(db, 'select 1 as x from teams limit 1')) === null) {
    await seedWorkspace(DEMO);
  }
}
