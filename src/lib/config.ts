import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { RelayRecord } from 'nostr-tools/relay';

export const defaultRelays: RelayRecord = {
	'wss://nrelay-jp.c-stellar.net/': { read: true, write: true },
	'wss://nrelay.c-stellar.net/': { read: true, write: false },
	'wss://nostream.ocha.one/': { read: true, write: true },
	'wss://nostr.compile-error.net/': { read: true, write: true }
};

export const profileRelays = ['wss://directory.yabu.me/', 'wss://purplepag.es/'];
export const searchRelays = ['wss://search.nos.today/', 'wss://nostr.wine/'];
export const subRelaysForChannel = ['wss://relay-jp.nostr.wirednet.jp/', 'wss://yabu.me/'];
export const urlToLinkProfileEditor = 'https://nos-profile-arekore.vercel.app/';
export const expansionThreshold = 5;
export const defaultReactionToShow = '⭐';
export const defaultReactionToAdd = '+';
export const zapNpub = 'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz';
export const zapNoteId = 'note1n5wkmwdg7tvl2xxrjuln3j05pheqhxptjlwqtf93z23c8uurjqkqtrdm3f';
const relaysToWrite = Object.entries(defaultRelays)
	.filter((v) => v[1].write)
	.map((v) => v[0]);
export const zapRelays = [...relaysToWrite, ...subRelaysForChannel];
export const uploaderURLs = [
	'https://yabu.me',
	'https://nostpic.com',
	'https://nostr.build',
	'https://nostrcheck.me',
	'https://void.cat',
	'https://files.sovbit.host'
];
export const getUrlToLinkProfile = (npub: string) => `https://yabu.me/${npub}`;
export const getRoboHashURL = (str: string) => `https://robohash.org/${str}?set=set4`;
export const defaultAccountUri = getRoboHashURL(
	nip19.npubEncode(getPublicKey(generateSecretKey()))
);
export const faviconImageUri = '/favicon.png';
export const zapImageUri = '/zap.png';
export const serviceLogoImageUri = '/nostr-logo-purple-transparent-92x36.png';
export const serviceIconImageUri = '/nostr-icon-purple-16x16.png';
export const titleLogoImageUri = '/banner.png';
