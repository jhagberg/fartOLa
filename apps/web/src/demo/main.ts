// Authored for fartola. Not ported from upstream.
//
// Entry of the public speaker demo (index.html next to this file). Does
// what the app's root layout does for a screen: fonts, design tokens and
// the texts, then mounts the demo. ?lang=en or ?lang=sv picks the language.

import '#lib/styles/fonts.css';
import '#lib/tokens.css';
import { mount } from 'svelte';
import { currentLocale, setLocale } from '#lib/i18n/index.ts';
import SpeakerDemo from './SpeakerDemo.svelte';

const lang = new URLSearchParams(window.location.search).get('lang');
if (lang === 'sv' || lang === 'en') setLocale(lang);
document.documentElement.lang = currentLocale();

mount(SpeakerDemo, { target: document.body });
