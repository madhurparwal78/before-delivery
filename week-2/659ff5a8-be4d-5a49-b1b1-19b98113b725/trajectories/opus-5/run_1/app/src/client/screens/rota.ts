import type { RegistrationDto, RotaHeat, RotaStation } from '../../shared/api';
import { api } from '../api';
import { copy } from '../copy';
import { el, openDialog, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { button, labelledSelect, liveRegion, runAction } from '../ui';
import { createEventShell } from './eventShell';

interface HeatBlock {
  root: HTMLElement;
  heading: HTMLElement;
  rows: HTMLElement;
  stationRows: Map<string, { root: HTMLElement; signature: string }>;
}

export function renderRota(ctx: ScreenContext): ScreenHandle {
  const shell = createEventShell(ctx, 'rota');
  const updates = liveRegion('Rota updates');
  const heatsHost = el('div', { class: 'rota' });
  replace(
    shell.content,
    el(
      'div',
      { class: 'rota-screen' },
      el('h1', { class: 'page-heading', text: 'Work rota' }),
      updates,
      heatsHost,
    ),
  );

  const blocks = new Map<number, HeatBlock>();
  let registrations: RegistrationDto[] = [];
  const canAssign =
    (ctx.user?.roles.includes('workers') ?? false) || (ctx.user?.roles.includes('chair') ?? false);

  function myRegistration(): RegistrationDto | null {
    return registrations.find((entry) => entry.driver.id === ctx.user?.id) ?? null;
  }

  function eligibleDrivers(heat: number): RegistrationDto[] {
    return registrations
      .filter((entry) => entry.runHeat !== heat && entry.station === null)
      .sort((a, b) => a.driver.name.localeCompare(b.driver.name));
  }

  function stationSignature(station: RotaStation, heat: number): string {
    const mine = myRegistration();
    return [
      station.id,
      station.worker ? `${station.worker.driverName}:${station.worker.carNumber}` : 'open',
      mine ? `${mine.id}:${mine.runHeat}:${mine.station?.id ?? 'none'}` : 'anon',
      heat,
      canAssign ? 'staff' : 'driver',
    ].join('|');
  }

  function buildStationRow(station: RotaStation, heat: number): HTMLElement {
    const mine = myRegistration();
    const worker = station.worker;
    const controls: HTMLElement[] = [];
    if (worker === null) {
      const claim = button(`Claim ${station.name}, heat ${heat}`, {
        onClick: () => {
          void runAction({
            control: claim,
            region: updates,
            pending: copy.rota.claimPending,
            run: () => api.stations.claim(station.id),
            success: (result) => {
              const line = copy.rota.claimed(station.name, heat);
              return result.station.assignmentEmail === 'pending'
                ? `${line} ${copy.rota.emailDelayed}`
                : line;
            },
            failure: (error) => {
              if (error.code === 'station_taken') return copy.rota.taken;
              if (error.code === 'own_heat') return copy.rota.ownHeat(mine?.runHeat ?? heat);
              if (error.code === 'already_assigned') return copy.rota.already;
              return error.message;
            },
          }).then(() => reload());
        },
      });
      controls.push(claim);
      if (canAssign) {
        const assign = button(`Assign ${station.name}, heat ${heat}`, {
          onClick: () => openAssignDialog(station, heat),
        });
        controls.push(assign);
      }
    } else {
      const isMine = mine !== null && worker.registrationId === mine.id;
      if (isMine || canAssign) {
        const release = button(`Release ${station.name}, heat ${heat}`, {
          onClick: () => {
            void runAction({
              control: release,
              region: updates,
              pending: copy.rota.releasePending,
              run: () => api.stations.release(station.id),
              success: () => copy.rota.released(station.name, heat),
              failure: (error) => error.message,
            }).then(() => reload());
          },
        });
        controls.push(release);
      }
    }

    return el(
      'li',
      { class: 'rota-row' },
      el('span', { class: 'rota-row__station', text: station.name }),
      el('span', {
        class: 'rota-row__worker',
        text: worker
          ? `${worker.driverName}, car ${worker.carNumber} ${worker.classCode}`
          : 'Open',
      }),
      el('span', { class: 'rota-row__controls' }, controls),
    );
  }

  function openAssignDialog(station: RotaStation, heat: number): void {
    const drivers = eligibleDrivers(heat);
    const picker = labelledSelect({
      label: 'Driver',
      id: 'assign-driver',
      options: drivers.map((driver) => ({
        value: driver.id,
        label: `${driver.driver.name}, car ${driver.carNumber} ${driver.classCode}`,
      })),
    });
    openDialog({
      name: 'Assign worker',
      heading: `Assign ${station.name}, heat ${heat}`,
      build: (close) => {
        const confirm = button('Assign', {
          variant: 'primary',
          onClick: () => {
            const chosen = drivers.find((driver) => driver.id === picker.select.value);
            void runAction({
              control: confirm,
              region: updates,
              pending: copy.rota.assignPending,
              run: () => api.stations.assign(station.id, picker.select.value),
              success: () =>
                copy.rota.assigned(chosen?.driver.name ?? 'The driver', station.name, heat),
              failure: (error) => {
                if (error.code === 'station_taken') return copy.rota.taken;
                if (error.code === 'own_heat') return copy.rota.ownHeat(chosen?.runHeat ?? heat);
                if (error.code === 'already_assigned') return copy.rota.already;
                return error.message;
              },
            }).then(async (result) => {
              if (result) close();
              await reload();
            });
          },
        });
        return [
          picker.wrapper,
          el('div', { class: 'dialog__actions' }, confirm, button('Cancel', { onClick: close })),
        ];
      },
    });
  }

  function paint(heats: RotaHeat[]): void {
    for (const heat of heats) {
      let block = blocks.get(heat.number);
      if (!block) {
        const heading = el('h2', { class: 'rota-heat__heading' });
        const rows = el('ul', { class: 'rota-heat__rows' });
        const root = el(
          'section',
          { class: 'rota-heat', attrs: { id: `heat-${heat.number}` } },
          heading,
          rows,
        );
        block = { root, heading, rows, stationRows: new Map() };
        blocks.set(heat.number, block);
        heatsHost.appendChild(root);
      }
      block.heading.textContent = copy.heatHeading(heat.number, heat.unfilled);
      const seen = new Set<string>();
      heat.stations.forEach((station, index) => {
        seen.add(station.id);
        const signature = stationSignature(station, heat.number);
        const existing = block.stationRows.get(station.id);
        if (existing && existing.signature === signature) return;
        const row = buildStationRow(station, heat.number);
        if (existing) existing.root.replaceWith(row);
        else block.rows.insertBefore(row, block.rows.children[index] ?? null);
        block.stationRows.set(station.id, { root: row, signature });
      });
      for (const [id, entry] of [...block.stationRows.entries()]) {
        if (!seen.has(id)) {
          entry.root.remove();
          block.stationRows.delete(id);
        }
      }
    }
  }

  async function reload(): Promise<void> {
    const [registrationResult] = await Promise.all([
      api.events.registrations(shell.eventId),
      shell.refreshRota(),
    ]);
    registrations = registrationResult.registrations;
    paint(shell.rota());
  }

  shell.onRota((heats) => paint(heats));
  shell.onHeatPicked((heat) => {
    document.getElementById(`heat-${heat}`)?.scrollIntoView({ block: 'start' });
  });

  const timer = window.setInterval(() => {
    void reload();
  }, 1_500);
  void reload();

  return {
    element: shell.element,
    destroy: () => {
      window.clearInterval(timer);
      shell.destroy();
    },
  };
}
