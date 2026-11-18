import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppsStore } from '../../core/apps.store';
import { UPDATE_PHASE_LABEL } from '../../../../shared/updates';
import { KIND_LABEL, OPEN_MODE_LABEL, STATUS_LABEL } from '../../core/models';
import { AppAvatar } from '../app-avatar/app-avatar';
import { Icon } from '../icon/icon';

/** Destaque do app selecionado, com o botão principal INICIAR/PARAR. */
@Component({
  selector: 'app-hero',
  imports: [Icon, AppAvatar],
  templateUrl: './app-hero.html',
  styleUrl: './app-hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppHero {
  protected readonly store = inject(AppsStore);

  protected readonly app = this.store.selected;
  protected readonly status = computed(() => {
    const a = this.app();
    return a ? this.store.statusOf(a.id) : 'stopped';
  });

  protected readonly update = computed(() => {
    const a = this.app();
    return a ? this.store.updates()[a.id] : undefined;
  });
  protected readonly progress = computed(() => {
    const a = this.app();
    return a ? this.store.updateProgress()[a.id] : undefined;
  });
  protected readonly updateError = computed(() => {
    const a = this.app();
    return a ? this.store.updateError()[a.id] : undefined;
  });

  protected readonly phaseLabel = UPDATE_PHASE_LABEL;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly openLabel = OPEN_MODE_LABEL;
  protected readonly statusLabel = STATUS_LABEL;
}
