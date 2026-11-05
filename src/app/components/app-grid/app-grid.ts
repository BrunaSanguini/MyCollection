import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AppsStore } from '../../core/apps.store';
import { KIND_LABEL } from '../../core/models';
import { AppAvatar } from '../app-avatar/app-avatar';
import { Icon } from '../icon/icon';

/** Grade de ícones: clique seleciona, duplo clique inicia/para. */
@Component({
  selector: 'app-grid',
  imports: [Icon, AppAvatar],
  templateUrl: './app-grid.html',
  styleUrl: './app-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppGrid {
  protected readonly store = inject(AppsStore);
  protected readonly kindLabel = KIND_LABEL;
}
