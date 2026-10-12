// Authored for fartola. Not ported from upstream.
//
// The recorded day the speaker demo plays (speaker-demo.json, written by
// fartOLa-tools/replay: invented names and clubs, moved times), and the
// classes shown from the start: as the speaker had them on the day, girls
// and women on the top row, boys and men below.

import raw from './speaker-demo.json' with { type: 'json' };
import type { SpeakerDemoData } from './playback.ts';

export const demoData: SpeakerDemoData = raw;
export const DEMO_CLASSES = ['D14', 'D16', 'D18', 'D21', 'H14', 'H16', 'H18', 'H21'];
