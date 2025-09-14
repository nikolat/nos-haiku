import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { WindowNostr } from 'nostr-tools/nip07';
import { browser } from '$app/environment';

const defaultLocale = 'en';
const languages = ['en', 'ja'];
const currentLang: string = (() => {
	return browser ? window.navigator.language : defaultLocale;
})();
export const initialLocale: string =
	browser && languages.includes(currentLang) ? currentLang : defaultLocale;

export const defaultRelays: string[] = [
	'wss://nrelay-jp.c-stellar.net/',
	'wss://nrelay.c-stellar.net/',
	'wss://nostream.ocha.one/',
	'wss://nostr.compile-error.net/'
];
export const indexerRelays = [
	'wss://directory.yabu.me/',
	'wss://purplepag.es/',
	'wss://user.kindpag.es/',
	'wss://indexer.coracle.social/'
];
export const profileRelays = ['wss://directory.yabu.me/', 'wss://user.kindpag.es/'];
export const searchRelays = ['wss://search.nos.today/'];
export const urlToLinkProfileEditor = 'https://nos-profile-arekore.vercel.app/';
export const urlToLinkRelayEditor = 'https://npub.dev/';
export const expansionThreshold = 5;
export const defaultReactionToShow = '⭐';
export const defaultReactionToAdd = '+';
export const defaultKindsSelected = [1, 6, 16, 20, 40, 42, 1068, 1111, 20000, 39701];
export const gitHubUrl = 'https://github.com/nikolat/nos-haiku';
export const zapNpub = 'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz';
export const zapNaddrId =
	'naddr1qvzqqqru7cpzq6c2vr8l8m9952e9qhxt8acn8kzzypzuhm6q70fvvxylkzu49e75qqxnzdenx5unvdpsxgenzvf4tnevyt';
export const clientTag = [
	'client',
	'Nos Haiku',
	'31990:6b0a60cff3eca5a2b2505ccb3f7133d8422045cbef40f3d2c6189fb0b952e7d4:1735964023115',
	'wss://nrelay.c-stellar.net/'
];
export const zapRelays = ['wss://relay-jp.nostr.wirednet.jp/', 'wss://yabu.me/'];
export const defaultUploaderURLsNip96 = [
	'https://yabu.me',
	'https://nostpic.com',
	'https://nostr.build',
	'https://nostrcheck.me',
	'https://void.cat',
	'https://files.sovbit.host'
];
export const defaultUploaderURLsBlossom = [
	'https://blossom.band',
	'https://cdn.nostrcheck.me',
	'https://nostr.download',
	'https://blossom.primal.net',
	'https://cdn.satellite.earth'
];
export const getUrlToLinkProfile = (npub: string) => `https://yabu.me/${npub}`;
export const getRoboHashURL = (str: string) => `https://robohash.org/${str}?set=set4`;
export const getClientURL = (naddr: nip19.NAddr) => `https://nostrapp.link/a/${naddr}/reviews`;
export const defaultAccountUri = getRoboHashURL(
	nip19.npubEncode(getPublicKey(generateSecretKey()))
);
export const faviconImageUri = '/favicon.png';
export const zapImageUri = '/zap.png';
export const serviceLogoImageUri = '/nostr-logo-purple-transparent-92x36.png';
export const serviceIconImageUri = '/nostr-icon-purple-16x16.png';
export const titleLogoImageUri = '/banner.png';

declare global {
	interface Window {
		nostr?: WindowNostr;
	}
}
