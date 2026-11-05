import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { ICON_COLOR_STYLE, IconColor, iconUrl, initialsOf } from '../../core/models';

/**
 * Ícone de um app: imagem personalizada (se houver) ou as iniciais na cor escolhida.
 * Se a imagem falhar ao carregar (arquivo apagado, modo navegador), cai para as iniciais.
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--av-bg]': 'colors().bg',
    '[style.--av-fg]': 'colors().fg',
    '[style.--av-font]': 'fontSize() + "px"',
    '[style.--av-radius]': 'radius() + "px"',
    'aria-hidden': 'true',
  },
  template: `
    @if (showImage()) {
      <img [src]="src()" alt="" draggable="false" (error)="broken.set(true)" />
    } @else {
      <span>{{ initials() }}</span>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: grid; place-items: center;
      width: 100%; aspect-ratio: 1 / 1; box-sizing: border-box;
      border-radius: var(--av-radius);
      background: var(--av-bg);
      border: 1px solid color-mix(in srgb, var(--av-fg) 22%, transparent);
      color: var(--av-fg);
      font-size: var(--av-font); font-weight: 700; letter-spacing: 1px;
      overflow: hidden;
      user-select: none;
    }
    img { width: 100%; height: 100%; object-fit: cover; }
  `,
})
export class AppAvatar {
  readonly name = input.required<string>();
  readonly icon = input<string | undefined>();
  readonly color = input<IconColor | undefined>();
  readonly fontSize = input(36);
  readonly radius = input(10);

  /** Reinicia quando o ícone muda */
  protected readonly broken = linkedSignal({ source: this.icon, computation: () => false });

  protected readonly initials = computed(() => initialsOf(this.name()));
  protected readonly colors = computed(() => ICON_COLOR_STYLE[this.color() ?? 'blue']);
  protected readonly src = computed(() => (this.icon() ? iconUrl(this.icon()!) : ''));
  protected readonly showImage = computed(() => !!this.icon() && !this.broken());
}
