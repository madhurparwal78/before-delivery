import { countTeams, createTeam, createUser } from '../db/accounts';
import {
  createGroup,
  createPage,
  createSite,
  createTab,
  createVersion,
  pagesOfVersion,
  replaceRedirects,
  setDefaultVersion,
  type Version,
} from '../db/content';
import { db, withTx } from '../db/pool';
import { recordSearch, setVote } from '../db/publishing';
import { hashPassword } from './passwords';
import { publishVersion, PublishBlocked, PublishFailed } from './publisher';

const INTRODUCTION = `## What Quire does

Quire keeps a small team's product notes in one place and prints them as a galley.

<Callout type="note">
Quire is an invented product used by this demo.
</Callout>

<Tabs>
<Tab title="Writers">
Writers keep the copy tidy.
</Tab>
<Tab title="Editors">
Editors mark the proofs.
</Tab>
</Tabs>

<CodeGroup>
\`\`\`bash Shell
quire build
\`\`\`
\`\`\`js JavaScript
import quire from "quire";
\`\`\`
</CodeGroup>

<Steps>
<Step title="Install Quire">
Follow [Install](/guides/install).
</Step>
</Steps>

<Accordion title="Does Quire need a network?">
No. Quire runs on your own machine.
</Accordion>

<Cards>
<Card title="Install" href="/guides/install">
Set Quire up in a minute.
</Card>
</Cards>

## Where to go next

Read [Configure](/guides/configure), then [Publishing](/guides/publish).
`;

const INSTALL = `## Requirements

Quire runs on Linux and macOS.

## Install from the registry

Run \`npm install quire\` and check the printed version.
`;

const CONFIGURE = `## The config file

Quire reads \`quire.json\` from the project root.

## Environment

Set \`QUIRE_ENV\` to \`dev\` or \`live\`.
`;

const PUBLISH = `## Before you publish

Check every link. See [Install](/guides/install#requirements).

## Publish

Press Publish and watch the proof margin fill with marks.
`;

const CLI = `## Commands

\`quire build\` prints the galley.

## Flags

\`--watch\` keeps printing as you type.
`;

const THEMES = `## Light and dark

Quire follows the system setting by default.

## Paper

Set the paper colour in \`quire.json\`.
`;

interface DemoPage {
  path: string;
  title: string;
  source: string;
}

const GUIDES: { title: string; groups: { title: string; pages: DemoPage[] }[] }[] = [
  {
    title: 'Guides',
    groups: [
      {
        title: 'Getting started',
        pages: [
          { path: 'introduction', title: 'Introduction', source: INTRODUCTION },
          { path: 'guides/install', title: 'Install', source: INSTALL },
          { path: 'guides/configure', title: 'Configure', source: CONFIGURE },
        ],
      },
      {
        title: 'Publishing',
        pages: [{ path: 'guides/publish', title: 'Publishing', source: PUBLISH }],
      },
    ],
  },
  {
    title: 'Reference',
    groups: [
      {
        title: 'CLI',
        pages: [{ path: 'reference/cli', title: 'CLI', source: CLI }],
      },
    ],
  },
];

/** The demo team and site, created only when the database has no teams. */
export async function seedDemoData(): Promise<void> {
  if ((await countTeams()) > 0) return;
  const seeded = await withTx(async (tx) => {
    const team = await createTeam(tx, 'Quire Labs');
    const owner = await createUser(tx, {
      teamId: team.id,
      email: 'ines@quire.test',
      name: 'Ines Varga',
      passwordHash: await hashPassword('quire-owner-2026'),
      role: 'owner',
    });
    await createUser(tx, {
      teamId: team.id,
      email: 'dara@quire.test',
      name: 'Dara Okafor',
      passwordHash: await hashPassword('quire-editor-2026'),
      role: 'editor',
    });
    await createUser(tx, {
      teamId: team.id,
      email: 'lev@quire.test',
      name: 'Lev Marsh',
      passwordHash: await hashPassword('quire-viewer-2026'),
      role: 'viewer',
    });
    const site = await createSite(tx, { teamId: team.id, slug: 'quire', title: 'Quire Docs' });
    const versions: Version[] = [];
    for (const spec of [
      { slug: 'v1', title: 'Version 1' },
      { slug: 'v2', title: 'Version 2' },
    ]) {
      const version = await createVersion(tx, {
        siteId: site.id,
        slug: spec.slug,
        title: spec.title,
        isDefault: spec.slug === 'v2',
      });
      versions.push(version);
      for (const tabSpec of GUIDES) {
        const tab = await createTab(tx, { versionId: version.id, title: tabSpec.title });
        for (const groupSpec of tabSpec.groups) {
          const group = await createGroup(tx, {
            versionId: version.id,
            tabId: tab.id,
            title: groupSpec.title,
          });
          const pages = [...groupSpec.pages];
          if (spec.slug === 'v2' && groupSpec.title === 'Getting started') {
            pages.push({ path: 'guides/themes', title: 'Themes', source: THEMES });
          }
          for (const pageSpec of pages) {
            await createPage(tx, {
              versionId: version.id,
              groupId: group.id,
              path: pageSpec.path,
              title: pageSpec.title,
              source: pageSpec.source,
              updatedBy: owner.id,
            });
          }
        }
      }
      if (spec.slug === 'v2') {
        await replaceRedirects(tx, version.id, [
          { from: '/setup', to: '/guides/install', kind: 'auto' },
        ]);
      }
    }
    return { site, versions };
  });

  const second = seeded.versions[1];
  const pages = await pagesOfVersion(db, second.id);
  const introduction = pages.find((page) => page.path === 'introduction');
  if (introduction !== undefined) {
    for (let i = 0; i < 7; i += 1) await setVote(`demo-yes-${i}`, introduction.id, 'yes');
    for (let i = 0; i < 2; i += 1) await setVote(`demo-no-${i}`, introduction.id, 'no');
  }
  for (let i = 0; i < 5; i += 1) {
    await recordSearch({ siteId: seeded.site.id, versionId: second.id, term: 'install', results: 3 });
  }

  for (const version of seeded.versions) {
    try {
      await publishVersion(seeded.site, version);
    } catch (error) {
      if (!(error instanceof PublishBlocked) && !(error instanceof PublishFailed)) throw error;
    }
  }
  await setDefaultVersion(seeded.site.id, second.id);
}
