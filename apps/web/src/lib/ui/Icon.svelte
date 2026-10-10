<!--
  Authored for fartola. Not ported from upstream.

  Icon — one icon set (Lucide, ISC) behind a small name map, so call
  sites stay `<Icon name="x" />` and only the icons we use are bundled.
  Decorative icons (next to a text label) are aria-hidden; a standalone
  icon must pass decorative={false} and an aria-label.
-->
<script module lang="ts">
  import type { Component } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Circle from '@lucide/svelte/icons/circle';
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
  import CreditCard from '@lucide/svelte/icons/credit-card';
  import Download from '@lucide/svelte/icons/download';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import House from '@lucide/svelte/icons/house';
  import Info from '@lucide/svelte/icons/info';
  import Key from '@lucide/svelte/icons/key';
  import List from '@lucide/svelte/icons/list';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Menu from '@lucide/svelte/icons/menu';
  import Mic from '@lucide/svelte/icons/mic';
  import Minimize from '@lucide/svelte/icons/minimize';
  import Minus from '@lucide/svelte/icons/minus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Printer from '@lucide/svelte/icons/printer';
  import Radio from '@lucide/svelte/icons/radio';
  import Search from '@lucide/svelte/icons/search';
  import Settings from '@lucide/svelte/icons/settings';
  import Shuffle from '@lucide/svelte/icons/shuffle';
  import Sun from '@lucide/svelte/icons/sun';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Trophy from '@lucide/svelte/icons/trophy';
  import UserPlus from '@lucide/svelte/icons/user-plus';
  import Users from '@lucide/svelte/icons/users';
  import X from '@lucide/svelte/icons/x';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ICONS: Record<string, Component<any>> = {
    home: House,
    radio: Radio,
    list: List,
    'arrow-up-right': ArrowUpRight,
    download: Download,
    key: Key,
    settings: Settings,
    check: Check,
    menu: Menu,
    x: X,
    users: Users,
    'user-plus': UserPlus,
    search: Search,
    plus: Plus,
    edit: Pencil,
    info: Info,
    'chevron-right': ChevronRight,
    'chevron-down': ChevronDown,
    shuffle: Shuffle,
    'alert-triangle': TriangleAlert,
    printer: Printer,
    'arrow-right': ArrowRight,
    'arrow-left': ArrowLeft,
    'arrow-left-right': ArrowLeftRight,
    minus: Minus,
    play: Play,
    'folder-open': FolderOpen,
    'corner-down-right': CornerDownRight,
    'credit-card': CreditCard,
    circle: Circle,
    mic: Mic,
    trophy: Trophy,
    sun: Sun,
    maximize: Maximize,
    minimize: Minimize,
  };
  export type IconName =
    | 'home' | 'radio' | 'list' | 'arrow-up-right' | 'download' | 'key' | 'settings'
    | 'check' | 'menu' | 'x' | 'users' | 'user-plus' | 'search' | 'plus' | 'edit'
    | 'info' | 'chevron-right' | 'chevron-down' | 'shuffle' | 'alert-triangle'
    | 'printer' | 'arrow-right' | 'arrow-left' | 'arrow-left-right' | 'minus'
    | 'play' | 'folder-open' | 'corner-down-right' | 'credit-card' | 'circle'
    | 'mic' | 'trophy' | 'sun' | 'maximize' | 'minimize';
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: number;
    /** Decorative icons (paired with a text label) get aria-hidden;
     * standalone icons MUST set this false AND pass an aria-label. */
    decorative?: boolean;
    'aria-label'?: string;
    fill?: string;
    class?: string;
  }

  let { name, size = 18, decorative = true, ...rest }: Props = $props();
  const Glyph = $derived(ICONS[name]!);
</script>

<Glyph
  {size}
  strokeWidth={2}
  aria-hidden={decorative ? 'true' : undefined}
  role={decorative ? undefined : 'img'}
  {...rest}
/>
