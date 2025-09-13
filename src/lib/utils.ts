import { sortEvents, verifyEvent, type NostrEvent, type VerifiedEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import type { RelayRecord } from 'nostr-tools/relay';
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import type { LazyFilter } from 'rx-nostr';
import {
	getCoordinateFromAddressPointer,
	getOutboxes,
	getProfileContent,
	getTagValue,
	type ProfileContent
} from 'applesauce-core/helpers';
import data from '@emoji-mart/data';
// @ts-expect-error なんもわからんかも
import type { BaseEmoji } from '@types/emoji-mart';
import { _ } from 'svelte-i18n';
import { get } from 'svelte/store';

export interface ProfileContentEvent extends ProfileContent {
	birthday?: {
		year?: number;
		month?: number;
		day?: number;
	};
	event: NostrEvent;
}

export interface ChannelContent extends nip19.EventPointer {
	eventkind40: NostrEvent;
	eventkind41?: NostrEvent;
	name?: string;
	about?: string;
	picture?: string;
	relays?: string[];
	categories: string[];
	pubkey: string;
	created_at: number;
}

export type UrlParams = {
	currentProfilePointer?: nip19.ProfilePointer;
	date?: Date;
	currentChannelPointer?: nip19.EventPointer;
	currentEventPointer?: nip19.EventPointer;
	currentAddressPointer?: nip19.AddressPointer;
	hashtag?: string;
	category?: string;
	query?: string;
	isSettings?: boolean;
	isAntenna?: boolean;
	isError?: boolean;
	isNIP05Fetching?: boolean;
};

interface MyBaseEmoji extends BaseEmoji {
	shortcodes: string;
	src: string | undefined;
}

export const kindsForParse: number[] = [1, 42, 1111, 30023, 39701];

export const getEventsAddressableLatest = (events: NostrEvent[]): NostrEvent[] => {
	const eventMap: Map<string, NostrEvent> = new Map<string, NostrEvent>();
	for (const ev of events) {
		if (!(isAddressableKind(ev.kind) || isReplaceableKind(ev.kind))) {
			continue;
		}
		const ap: nip19.AddressPointer = {
			...ev,
			identifier: isAddressableKind(ev.kind) ? (getTagValue(ev, 'd') ?? '') : ''
		};
		const s: string = getCoordinateFromAddressPointer(ap);
		const event: NostrEvent | undefined = eventMap.get(s);
		if (event === undefined || ev.created_at > event.created_at) {
			eventMap.set(s, ev);
		}
	}
	return sortEvents(Array.from(eventMap.values()));
};

const dtformat = new Intl.DateTimeFormat('ja-jp', {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

export const getAbsoluteTime = (unixTime: number): string => {
	return dtformat.format(new Date(unixTime * 1000)).replaceAll('/', '-');
};

export const getRelativeTime = (nowRealtime: number, unixTime: number): string => {
	const diff = nowRealtime - unixTime;
	const $_ = (s: string): string => get(_)(s);
	let r: string;
	let n: number;
	if (diff <= 0) {
		n = 0;
		r = $_('utils.now');
	} else if (diff < 60) {
		n = diff;
		r = `${n}${$_('utils.seconds-ago')}`;
	} else if (diff < 60 * 60) {
		n = Math.floor(diff / 60);
		r = `${n}${$_('utils.minutes-ago')}`;
	} else if (diff < 60 * 60 * 24) {
		n = Math.floor(diff / (60 * 60));
		r = `${n}${$_('utils.hours-ago')}`;
	} else if (diff < 60 * 60 * 24 * 30) {
		n = Math.floor(diff / (60 * 60 * 24));
		r = `${n}${$_('utils.days-ago')}`;
	} else if (diff < 60 * 60 * 24 * 30 * 12) {
		n = Math.floor(diff / (60 * 60 * 24 * 30));
		r = `${n}${$_('utils.months-ago')}`;
	} else {
		n = Math.floor(diff / (60 * 60 * 24 * 30 * 12));
		r = `${n}${$_('utils.years-ago')}`;
	}
	if (n === 1) {
		r = r.replace('s ago', ' ago');
	}
	return r;
};

export const getTimeRemaining = (nowRealtime: number, unixTime: number): string => {
	let diff = unixTime - nowRealtime;
	if (diff < 0) {
		diff = 0;
	}
	const hours = String(Math.floor(diff / (60 * 60))).padStart(2, '0');
	const minutes = String(Math.floor((diff % (60 * 60)) / 60)).padStart(2, '0');
	const seconds = String(diff % 60).padStart(2, '0');
	return `${hours}:${minutes}:${seconds}`;
};

const getSats = (event9734: NostrEvent): number | null => {
	const amount = event9734.tags
		.find((tag: string[]) => tag.length >= 2 && tag[0] === 'amount')
		?.at(1);
	if (amount === undefined || !/^\d+$/.test(amount)) {
		return null;
	}
	const zapAmount = parseInt(amount) / 1000;
	return zapAmount;
};

export const getEvent9734 = (event: NostrEvent): VerifiedEvent | null => {
	if (event.kind !== 9735) {
		return null;
	}
	const description = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'description')?.at(1);
	if (description === undefined) {
		return null;
	}
	//kind9734の検証
	let event9734: NostrEvent;
	try {
		event9734 = JSON.parse(description);
	} catch (error) {
		console.warn(error);
		return null;
	}
	if (!verifyEvent(event9734)) {
		return null;
	}
	return event9734;
};

export const getEvent9734WithVerification = async (
	event: NostrEvent,
	profile: ProfileContentEvent
): Promise<VerifiedEvent | null> => {
	if (event.kind !== 9735) {
		return null;
	}
	const description = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'description')?.at(1);
	if (description === undefined) {
		return null;
	}
	//kind9734の検証
	let event9734: NostrEvent;
	try {
		event9734 = JSON.parse(description);
	} catch (error) {
		console.warn(error);
		return null;
	}
	if (!verifyEvent(event9734)) {
		return null;
	}
	//kind9735の検証
	const lud16 = profile.lud16;
	if (lud16 === undefined) {
		return null;
	}
	const m = lud16.match(/^([^@]+)@([^@]+)$/);
	if (m === null) {
		return null;
	}
	const url = `https://${m[2]}/.well-known/lnurlp/${m[1]}`;
	if (!URL.canParse(url)) {
		return null;
	}
	let nostrPubkey: string;
	try {
		const response = await fetch(url);
		const json = await response.json();
		nostrPubkey = json.nostrPubkey;
	} catch (error) {
		console.warn(error);
		return null;
	}
	if (event.pubkey !== nostrPubkey) {
		console.warn('fake zap', event);
		return null;
	}
	const zapAmount: number | null = getSats(event9734);
	if (zapAmount === null) {
		return null;
	}
	return event9734;
};

export const getAddressPointerFromAId = (aId: string): nip19.AddressPointer | null => {
	const sp = aId.split(':');
	if (sp.length < 3) {
		return null;
	}
	try {
		const ap: nip19.AddressPointer = { identifier: sp[2], pubkey: sp[1], kind: parseInt(sp[0]) };
		return ap;
	} catch (error) {
		console.warn(error);
		return null;
	}
};

export const splitNip51ListPublic = (
	event: NostrEvent
): {
	pPub: string[];
	ePub: string[];
	wPub: string[];
	tPub: string[];
	tagList: string[][];
} => {
	const getList = (tags: string[][], tagName: string): string[] =>
		Array.from(
			new Set<string>(
				tags.filter((tag) => tag.length >= 2 && tag[0] === tagName).map((tag) => tag[1])
			)
		);
	const [pPub, ePub, wPub, tPub] = ['p', 'e', 'word', 't'].map((tagName: string) =>
		getList(event.tags, tagName)
	);
	const tagList: string[][] = event.tags;
	return { pPub, ePub, wPub, tPub, tagList };
};

export const getEncrypt = (): ((pubkey: string, plaintext: string) => Promise<string>) | null => {
	if (window.nostr?.nip44?.encrypt !== undefined) {
		return window.nostr.nip44.encrypt;
	} else if (window.nostr?.nip04?.encrypt !== undefined) {
		return window.nostr.nip04.encrypt;
	}
	return null;
};

const getDecrypt = (
	content: string
): ((pubkey: string, ciphertext: string) => Promise<string>) | null => {
	const isNIP04: boolean = content.includes('?iv=');
	if (isNIP04 && window.nostr?.nip04?.decrypt !== undefined) {
		return window.nostr.nip04.decrypt;
	} else if (window.nostr?.nip44?.decrypt !== undefined) {
		return window.nostr.nip44.decrypt;
	}
	return null;
};

export const splitNip51List = async (
	event: NostrEvent,
	loginPubkey: string
): Promise<{
	pPub: string[];
	ePub: string[];
	wPub: string[];
	tPub: string[];
	pSec: string[];
	eSec: string[];
	wSec: string[];
	tSec: string[];
	tagList: string[][];
	contentList: string[][];
}> => {
	const getList = (tags: string[][], tagName: string): string[] =>
		Array.from(
			new Set<string>(
				tags.filter((tag) => tag.length >= 2 && tag[0] === tagName).map((tag) => tag[1])
			)
		);
	const [pPub, ePub, wPub, tPub] = ['p', 'e', 'word', 't'].map((tagName: string) =>
		getList(event.tags, tagName)
	);
	let [pSec, eSec, wSec, tSec]: [string[], string[], string[], string[]] = [[], [], [], []];
	const tagList: string[][] = event.tags;
	let contentList: string[][] = [];
	if (event.content.length > 0) {
		const decrypt = getDecrypt(event.content);
		if (decrypt !== null) {
			try {
				const content = await decrypt(loginPubkey, event.content);
				contentList = JSON.parse(content);
			} catch (error) {
				console.warn(error);
			}
		}
		[pSec, eSec, wSec, tSec] = ['p', 'e', 'word', 't'].map((tagName: string) =>
			getList(contentList, tagName)
		);
	}
	return { pPub, ePub, wPub, tPub, pSec, eSec, wSec, tSec, tagList, contentList };
};

export const getMuteList = async (
	eventMuteList: NostrEvent | undefined,
	loginPubkey: string | undefined
): Promise<[string[], string[], string[], string[]]> => {
	let [mutedPubkeys, mutedIds, mutedWords, mutedHashTags]: [
		string[],
		string[],
		string[],
		string[]
	] = [[], [], [], []];
	if (
		eventMuteList === undefined ||
		loginPubkey === undefined ||
		eventMuteList.pubkey !== loginPubkey
	) {
		return [mutedPubkeys, mutedIds, mutedWords, mutedHashTags];
	}
	const { pPub, ePub, wPub, tPub, pSec, eSec, wSec, tSec } = await splitNip51List(
		eventMuteList,
		loginPubkey
	);
	mutedPubkeys = Array.from(new Set<string>([...pPub, ...pSec]));
	mutedIds = Array.from(new Set<string>([...ePub, ...eSec]));
	mutedWords = Array.from(new Set<string>([...wPub, ...wSec].map((w) => w.toLowerCase())));
	mutedHashTags = Array.from(new Set<string>([...tPub, ...tSec].map((t) => t.toLowerCase())));
	return [mutedPubkeys, mutedIds, mutedWords, mutedHashTags];
};

export const getBlockedRelaysList = async (
	eventBlockedRelaysList: NostrEvent | undefined,
	loginPubkey: string | undefined
): Promise<string[]> => {
	if (
		eventBlockedRelaysList === undefined ||
		loginPubkey === undefined ||
		eventBlockedRelaysList.pubkey !== loginPubkey
	) {
		return [];
	}
	const getRelayList = (tags: string[][]): string[] =>
		Array.from(
			new Set<string>(
				tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'relay')
					.map((tag) => normalizeURL(tag[1]))
			)
		);
	const pubRelays: string[] = getRelayList(eventBlockedRelaysList.tags);
	let secRelays: string[] = [];
	if (eventBlockedRelaysList.content.length > 0) {
		let contentList: string[][] = [];
		const decrypt = getDecrypt(eventBlockedRelaysList.content);
		if (decrypt !== null) {
			try {
				const content = await decrypt(loginPubkey, eventBlockedRelaysList.content);
				contentList = JSON.parse(content);
			} catch (error) {
				console.warn(error);
			}
		}
		secRelays = getRelayList(contentList);
	}
	return Array.from(new Set<string>([...pubRelays, ...secRelays]));
};

export const getEventsFilteredByMute = (
	events: NostrEvent[],
	mutedPubkeys: string[],
	mutedIds: string[],
	mutedWords: string[],
	mutedHashTags: string[]
) => {
	const filteredEvents: NostrEvent[] = [];
	for (const event of events) {
		if (mutedPubkeys.includes(event.pubkey)) {
			continue;
		}
		if (mutedIds.includes(event.id)) {
			continue;
		}
		if (mutedWords.some((word) => event.content.includes(word))) {
			continue;
		}
		if (
			mutedHashTags.some((hashTag) =>
				event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 't')
					.map((tag) => tag[1].toLowerCase())
					.includes(hashTag)
			)
		) {
			continue;
		}
		filteredEvents.push(event);
	}
	return filteredEvents;
};

export const getPubkeysForFilter = (
	events: NostrEvent[]
): { pubkeys: string[]; relays: string[] } => {
	const pubkeySet: Set<string> = new Set();
	const relaySet: Set<string> = new Set<string>();
	for (const ev of events) {
		let content: string | undefined = undefined;
		if (ev.kind === 0) {
			content = getProfileContent(ev).about;
		} else if (kindsForParse.includes(ev.kind)) {
			content = ev.content;
		}
		if (content !== undefined) {
			const matchesIterator = content.matchAll(
				/nostr:(npub1\w{58}|nprofile1\w+|nevent1\w+|naddr1\w+)/g
			);
			for (const match of matchesIterator) {
				let d;
				try {
					d = nip19.decode(match[1]);
				} catch (_error) {
					continue;
				}
				if (d.type === 'npub') {
					pubkeySet.add(d.data);
				} else if (d.type === 'nprofile') {
					pubkeySet.add(d.data.pubkey);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				} else if (d.type === 'nevent' && d.data.author !== undefined) {
					pubkeySet.add(d.data.author);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				} else if (d.type === 'naddr') {
					pubkeySet.add(d.data.pubkey);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays) {
							relaySet.add(normalizeURL(relay));
						}
					}
				}
			}
		}
	}
	return { pubkeys: Array.from(pubkeySet), relays: Array.from(relaySet) };
};

export const getIdsForFilter = (
	events: NostrEvent[]
): { ids: string[]; aps: nip19.AddressPointer[]; relays: string[] } => {
	const idSet: Set<string> = new Set<string>();
	const aps: nip19.AddressPointer[] = [];
	const apsSet: Set<string> = new Set<string>();
	const relaySet: Set<string> = new Set<string>();
	for (const ev of events) {
		let content: string | undefined = undefined;
		if (ev.kind === 0) {
			content = getProfileContent(ev).about;
		} else if (kindsForParse.includes(ev.kind)) {
			content = ev.content;
		}
		if (content !== undefined) {
			const matchesIterator = content.matchAll(/nostr:(note1\w{58}|nevent1\w+|naddr1\w+)/g);
			for (const match of matchesIterator) {
				let d;
				try {
					d = nip19.decode(match[1]);
				} catch (_error) {
					continue;
				}
				if (d.type === 'note') {
					idSet.add(d.data);
				} else if (d.type === 'nevent') {
					idSet.add(d.data.id);
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays.filter((relay) => URL.canParse(relay))) {
							relaySet.add(normalizeURL(relay));
						}
					}
				} else if (d.type === 'naddr') {
					const str = getCoordinateFromAddressPointer(d.data);
					if (!apsSet.has(str)) {
						aps.push(d.data);
						apsSet.add(str);
					}
					if (d.data.relays !== undefined) {
						for (const relay of d.data.relays.filter((relay) => URL.canParse(relay))) {
							relaySet.add(normalizeURL(relay));
						}
					}
				}
			}
		}
	}
	return { ids: Array.from(idSet), aps: aps, relays: Array.from(relaySet) };
};

export const getTagsForContent = (
	content: string,
	eventsEmojiSet: NostrEvent[],
	getRelayHintEvent: (targetEvent: NostrEvent, relays?: string[]) => string | undefined,
	getRelayHintAuhor: (pubkey: string, relays?: string[]) => string | undefined,
	getEventsByFilter: (filters: Filter | Filter[]) => NostrEvent[],
	getReplaceableEvent: (kind: number, pubkey: string, d?: string) => NostrEvent | undefined,
	imetaMap?: Map<
		string,
		{
			tags: [string, string][];
			content: string;
		}
	>
): string[][] => {
	const tags: string[][] = [];
	const ppMap: Map<string, nip19.ProfilePointer> = new Map<string, nip19.ProfilePointer>();
	const epMap: Map<string, nip19.EventPointer> = new Map<string, nip19.EventPointer>();
	const apMap: Map<string, nip19.AddressPointer> = new Map<string, nip19.AddressPointer>();
	const matchesIteratorId = content.matchAll(
		/(^|\W|\b)(nostr:(note1\w{58}|nevent1\w+|naddr1\w+))($|\W|\b)/g
	);
	for (const match of matchesIteratorId) {
		let d;
		try {
			d = nip19.decode(match[3]);
		} catch (_error) {
			continue;
		}
		if (d.type === 'note') {
			epMap.set(d.data, { id: d.data });
		} else if (d.type === 'nevent') {
			if (!epMap.has(d.data.id) || d.data.relays !== undefined) {
				epMap.set(d.data.id, d.data);
			}
			if (d.data.author !== undefined) {
				ppMap.set(d.data.author, { pubkey: d.data.author });
			}
		} else if (d.type === 'naddr') {
			const c = getCoordinateFromAddressPointer(d.data);
			if (!apMap.has(c) || d.data.relays !== undefined) {
				apMap.set(c, d.data);
			}
			ppMap.set(d.data.pubkey, { pubkey: d.data.pubkey });
		}
	}
	const matchesIteratorPubkey = content.matchAll(
		/(^|\W|\b)(nostr:(npub1\w{58}|nprofile1\w+))($|\W|\b)/g
	);
	for (const match of matchesIteratorPubkey) {
		let d;
		try {
			d = nip19.decode(match[3]);
		} catch (_error) {
			continue;
		}
		if (d.type === 'npub') {
			if (!ppMap.has(d.data)) {
				ppMap.set(d.data, { pubkey: d.data });
			}
		} else if (d.type === 'nprofile') {
			if (!ppMap.has(d.data.pubkey) || d.data.relays !== undefined) {
				ppMap.set(d.data.pubkey, d.data);
			}
		}
	}
	const matchesIteratorHashTag = content.matchAll(/(^|\s)#([^\s#]+)/g);
	const hashtags: Set<string> = new Set();
	for (const match of matchesIteratorHashTag) {
		hashtags.add(match[2].toLowerCase());
	}
	const matchesIteratorLink = content.matchAll(/https?:\/\/[\w!?/=+\-_~:;.,*&@#$%()[\]]+/g);
	const links: Set<string> = new Set<string>();
	for (const match of matchesIteratorLink) {
		links.add(urlLinkString(match[0])[0]);
	}
	const imetaTags: string[][] = [];
	if (imetaMap !== undefined) {
		for (const [url, imeta] of imetaMap) {
			if (!links.has(url)) {
				continue;
			}
			imetaTags.push([
				'imeta',
				...imeta.tags
					.filter((tag) => tag.length >= 2 && tag[0].length > 0 && tag[1].length > 0)
					.map((tag) => `${tag[0]} ${tag[1]}`)
			]);
		}
	}
	const emojiMapToAdd: Map<string, string> = new Map<string, string>();
	const emojiMap: Map<string, string> = getEmojiMap(eventsEmojiSet);
	const matchesIteratorEmojiTag = content.matchAll(
		new RegExp(`:(${Array.from(emojiMap.keys()).join('|')}):`, 'g')
	);
	for (const match of matchesIteratorEmojiTag) {
		const url = emojiMap.get(match[1]);
		if (url !== undefined) {
			emojiMapToAdd.set(match[1], url);
		}
	}
	for (const [id, ep] of epMap) {
		const qTag: string[] = ['q', id];
		const ev: NostrEvent | undefined = getEventsByFilter({ ids: [id] }).at(0);
		const recommendedRelayForQuote: string | undefined =
			ev === undefined ? undefined : getRelayHintEvent(ev, ep.relays);
		const pubkey: string | undefined = ev?.pubkey ?? ep.author;
		if (recommendedRelayForQuote !== undefined) {
			qTag.push(normalizeURL(recommendedRelayForQuote));
			if (pubkey !== undefined) {
				qTag.push(pubkey);
			}
		}
		tags.push(qTag);
		if (pubkey !== undefined && !ppMap.has(pubkey)) {
			ppMap.set(pubkey, { pubkey });
		}
	}
	for (const [a, ap] of apMap) {
		const qTag: string[] = ['q', a];
		const ev: NostrEvent | undefined = getReplaceableEvent(ap.kind, ap.pubkey, ap.identifier);
		const recommendedRelayForQuote: string | undefined =
			ev === undefined ? undefined : getRelayHintEvent(ev, ap.relays);
		if (recommendedRelayForQuote !== undefined) {
			qTag.push(normalizeURL(recommendedRelayForQuote));
		}
		tags.push(qTag);
		if (!ppMap.has(ap.pubkey)) {
			ppMap.set(ap.pubkey, { pubkey: ap.pubkey });
		}
	}
	for (const [p, pp] of ppMap) {
		const pTag: string[] = ['p', p];
		const recommendedRelayForPubkey: string | undefined = getRelayHintAuhor(p, pp.relays);
		if (recommendedRelayForPubkey !== undefined) {
			pTag.push(normalizeURL(recommendedRelayForPubkey));
		}
		tags.push(pTag);
	}
	for (const t of hashtags) {
		tags.push(['t', t]);
	}
	for (const r of links) {
		tags.push(['r', r]);
	}
	for (const imetaTag of imetaTags) {
		tags.push(imetaTag);
	}
	for (const [shortcode, url] of emojiMapToAdd) {
		tags.push(['emoji', shortcode, url]);
	}
	return tags;
};

export const mergeFilterForAddressableEvents = (filters: LazyFilter[]): Filter[] => {
	const kinds: Set<number> = new Set<number>(filters.map((f) => f.kinds ?? []).flat());
	const newFilters: Filter[] = [];
	for (const kind of kinds) {
		const filterMap: Map<string, Set<string>> = new Map<string, Set<string>>();
		for (const filter of filters.filter((f) => f.kinds?.includes(kind))) {
			const author: string = filter.authors?.at(0) ?? '';
			const dTags: string[] = filter['#d'] ?? [];
			if (filterMap.has(author)) {
				for (const dTag of dTags) {
					filterMap.set(author, filterMap.get(author)!.add(dTag));
				}
			} else {
				filterMap.set(author, new Set<string>(dTags));
			}
		}
		for (const [author, dTagSet] of filterMap) {
			const filter: Filter = { kinds: [kind], authors: [author] };
			if (isAddressableKind(kind)) {
				filter['#d'] = Array.from(dTagSet);
			}
			newFilters.push(filter);
		}
	}
	return newFilters;
};

export const getRelaysToUseFromKind10002Event = (event?: NostrEvent): RelayRecord => {
	const newRelays: RelayRecord = {};
	for (const tag of event?.tags.filter(
		(tag) => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1])
	) ?? []) {
		const url: string = normalizeURL(tag[1]);
		const isRead: boolean = tag.length === 2 || tag[2] === 'read';
		const isWrite: boolean = tag.length === 2 || tag[2] === 'write';
		if (newRelays[url] === undefined) {
			newRelays[url] = {
				read: isRead,
				write: isWrite
			};
		} else {
			if (isRead) {
				newRelays[url].read = true;
			}
			if (isWrite) {
				newRelays[url].write = true;
			}
		}
	}
	return newRelays;
};

export const getReadRelaysWithOutboxModel = (
	pubkeys: string[],
	getReplaceable: (kind: number, pubkey: string, d?: string) => NostrEvent | undefined,
	relayFilter: (relay: string) => boolean
): string[] => {
	const relayUserMap: Map<string, Set<string>> = new Map<string, Set<string>>();
	for (const pubkey of pubkeys) {
		const event: NostrEvent | undefined = getReplaceable(10002, pubkey);
		if (event === undefined) {
			continue;
		}
		const relays = getOutboxes(event).filter(relayFilter);
		for (const relayUrl of relays) {
			const users: Set<string> = relayUserMap.get(relayUrl) ?? new Set<string>();
			users.add(pubkey);
			relayUserMap.set(relayUrl, users);
		}
	}
	return getRequiredRelays(relayUserMap);
};

const getRequiredRelays = (relayUserMap: Map<string, Set<string>>): string[] => {
	const relayUserMapArray: [string, string[]][] = [];
	for (const [relayUrl, users] of relayUserMap) {
		relayUserMapArray.push([relayUrl, Array.from(users)]);
	}
	const compareFn = (a: [string, string[]], b: [string, string[]]) => {
		return b[1].length - a[1].length;
	};
	relayUserMapArray.sort(compareFn);
	const relaysAll: string[] = relayUserMapArray.map((a) => a[0]);
	const relaySet: Set<string> = new Set<string>();
	const allPubkeySet: Set<string> = new Set<string>(relayUserMapArray.map((e) => e[1]).flat());
	const relayUserMapCloned: Map<string, Set<string>> = new Map<string, Set<string>>();
	for (const up of relayUserMapArray) {
		relayUserMapCloned.set(up[0], new Set<string>(up[1]));
	}
	for (const relay of relaysAll) {
		if (allPubkeySet.size === 0) {
			break;
		}
		const users: Set<string> = relayUserMapCloned.get(relay) ?? new Set<string>();
		if (Array.from(users).some((p) => allPubkeySet.has(p))) {
			relaySet.add(relay);
			relayUserMapCloned.set(
				relay,
				new Set<string>(Array.from(users).filter((p) => allPubkeySet.has(p)))
			);
			for (const p of users) {
				allPubkeySet.delete(p);
			}
		}
	}
	return Array.from(relaySet);
};

const inputCount = (input: string): number => {
	// simple check, not perfect
	const segmeter = new Intl.Segmenter('ja-JP', { granularity: 'word' });
	return Array.from(segmeter.segment(input)).length;
};

export const isCustomEmoji = (event: NostrEvent): boolean => {
	const emojiTags = event.tags.filter((tag) => tag[0] === 'emoji');
	if (emojiTags.length !== 1) return false;
	const emojiTag = emojiTags[0];
	return (
		emojiTag.length >= 3 &&
		/^\w+$/.test(emojiTag[1]) &&
		URL.canParse(emojiTag[2]) &&
		event.content === `:${emojiTag[1]}:`
	);
};

export const isValidEmoji = (event: NostrEvent): boolean => {
	return isCustomEmoji(event) || inputCount(event.content) <= 1;
};

export const getPubkeyIfValid = (pubkey: string | undefined): string | undefined => {
	if (pubkey === undefined) {
		return undefined;
	}
	return isValidPubkey(pubkey) ? pubkey : undefined;
};

const isValidPubkey = (pubkey: string): boolean => {
	try {
		nip19.npubEncode(pubkey);
		return true;
	} catch (_error) {
		return false;
	}
};

export const zap = async (
	npub: string,
	noteId: string | undefined,
	naddrId: string | undefined,
	relays: string[],
	zapWindowContainer: HTMLElement | undefined
): Promise<void> => {
	if (zapWindowContainer === undefined) {
		return;
	} else if (zapWindowContainer.children.length > 0) {
		const elm = zapWindowContainer.children[0];
		elm.dispatchEvent(new Event('click'));
		return;
	}
	// @ts-expect-error 型なんて定義されてないよ
	const { initTarget } = await import('nostr-zap/src/view');
	const elm: HTMLButtonElement = document.createElement('button');
	elm.style.display = 'none';
	elm.dataset.npub = npub;
	elm.dataset.noteId = noteId;
	elm.dataset.naddr = naddrId;
	elm.dataset.relays = relays.join(',');
	zapWindowContainer.append(elm);
	initTarget(elm);
	elm.dispatchEvent(new Event('click'));
};

export const getEmojiMap = (eventsEmojiSet: NostrEvent[]): Map<string, string> => {
	const r = new Map<string, string>();
	for (const ev of eventsEmojiSet) {
		const emojiTags: string[][] = ev.tags.filter(
			(tag) => tag.length >= 3 && tag[0] === 'emoji' && /^\w+$/.test(tag[1]) && URL.canParse(tag[2])
		);
		for (const emojiTag of emojiTags) {
			const shortcode = emojiTag[1];
			const url = emojiTag[2];
			const urlStored = r.get(shortcode);
			if (urlStored === undefined) {
				r.set(shortcode, url);
			} else if (urlStored !== url) {
				let i = 2;
				while (true) {
					const shortcodeAnother = `${shortcode}_${i}`;
					const urlStored2 = r.get(shortcodeAnother);
					if (urlStored2 === undefined) {
						r.set(shortcodeAnother, url);
						break;
					}
					if (urlStored2 === url) {
						break;
					}
					i++;
				}
			}
		}
	}
	return r;
};

export const getEmoji = async (
	emojiPickerContainer: HTMLElement,
	emojiMap: Map<string, string>,
	autoClose: boolean,
	onCallbackEmojiSelect: ({
		emojiStr,
		emojiUrl
	}: {
		emojiStr: string;
		emojiUrl: string | undefined;
	}) => void
): Promise<void> => {
	const { Picker } = await import('emoji-mart');
	return new Promise((resolve) => {
		if (emojiPickerContainer.children.length > 0) {
			resolve();
			return;
		}
		const close = () => {
			emojiPickerContainer.firstChild?.remove();
			resolve();
		};
		const onEmojiSelect = (emoji: MyBaseEmoji) => {
			const emojiStr = emoji.native ?? emoji.shortcodes;
			const emojiUrl = emoji.src;
			onCallbackEmojiSelect({ emojiStr, emojiUrl });
			if (autoClose) {
				close();
			}
		};
		const onClickOutside = () => {
			close();
		};
		const picker = new Picker({
			data,
			custom: [
				{
					id: 'custom-emoji',
					name: 'Custom Emojis',
					emojis: Array.from(emojiMap.entries()).map(([shortcode, url]) => {
						return {
							id: shortcode,
							name: shortcode,
							keywords: [shortcode],
							skins: [{ shortcodes: `:${shortcode}:`, src: url }]
						};
					})
				}
			],
			autoFocus: true,
			onEmojiSelect,
			onClickOutside
		});
		//スマホで1回目に生成したインスタンスがonClickOutsideを呼び続けるので回避するためタイマーを仕掛ける
		setTimeout(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			emojiPickerContainer.appendChild(picker as any);
		}, 10);
	});
};

const indexOfFirstUnmatchingCloseParen = (url: string, left: string, right: string): number => {
	let nest = 0;
	for (let i = 0; i < url.length; i++) {
		const c = url.charAt(i);
		if (c === left) {
			nest++;
		} else if (c === right) {
			if (nest <= 0) {
				return i;
			}
			nest--;
		}
	}
	return -1;
};

//https://github.com/jiftechnify/motherfucking-nostr-client
export const urlLinkString = (url: string): [string, string] => {
	for (const [left, right] of [
		['(', ')'],
		['[', ']']
	]) {
		const splitIdx: number = indexOfFirstUnmatchingCloseParen(url, left, right);
		if (splitIdx >= 0) {
			return [url.substring(0, splitIdx), url.substring(splitIdx)];
		}
	}
	return [url, ''];
};

export const loginWithNpub = (npub: string) => {
	document.dispatchEvent(new CustomEvent('nlLaunch', { detail: 'login-read-only' }));
	const intervalIDLaunch = setInterval(() => {
		const nlauth = document.querySelector('nl-auth');
		if (nlauth === null || nlauth.shadowRoot === null) {
			return;
		}
		const nlinput: HTMLInputElement | null = nlauth.shadowRoot.querySelector('.nl-input');
		if (nlinput === null) {
			return;
		}
		clearInterval(intervalIDLaunch);
		nlinput.value = npub;
		nlinput.dispatchEvent(new Event('input'));
		const intervalIDLogin = setInterval(() => {
			if (nlauth === null || nlauth.shadowRoot === null) {
				return;
			}
			const nlbutton: HTMLButtonElement | null = nlauth.shadowRoot.querySelector('.nl-button');
			if (nlbutton === null) {
				return;
			}
			clearInterval(intervalIDLogin);
			nlbutton.click();
		}, 100);
	}, 100);
};

const getCategories = (event: NostrEvent): string[] =>
	Array.from(
		new Set<string>(
			event.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 't' && /^[^\s#]+$/.test(tag[1]))
				.map((tag) => tag[1].toLowerCase())
		)
	);

export const getChannelContent = (event: NostrEvent): ChannelContent | null => {
	let channel: ChannelContent;
	try {
		channel = JSON.parse(event.content);
	} catch (error) {
		console.warn(error);
		return null;
	}
	if (Array.isArray(channel.relays)) {
		channel.relays = Array.from(
			new Set<string>(
				channel.relays.filter((relay) => URL.canParse(relay)).map((relay) => normalizeURL(relay))
			)
		);
	} else {
		channel.relays = [];
	}
	channel.categories = getCategories(event);
	channel.id = event.id;
	channel.kind = event.kind;
	channel.pubkey = event.pubkey;
	channel.author = event.pubkey;
	channel.created_at = event.created_at;
	return channel;
};

export const getChannelMap = (eventsChannel: NostrEvent[], eventsChannelEdit: NostrEvent[]) => {
	const channelMap = new Map<string, ChannelContent>();
	for (const ev of eventsChannel) {
		const channel: ChannelContent | null = getChannelContent(ev);
		if (channel !== null) {
			channel.eventkind40 = ev;
			channelMap.set(ev.id, channel);
		}
	}
	for (const ev of eventsChannelEdit) {
		const id = ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1);
		if (id === undefined) continue;
		const c = channelMap.get(id);
		if (c !== undefined) {
			if (ev.created_at <= c.created_at) {
				continue;
			}
			if (c.pubkey === ev.pubkey) {
				const channel: ChannelContent | null = getChannelContent(ev);
				if (channel === null) {
					continue;
				}
				channel.eventkind40 = c.eventkind40;
				channel.eventkind41 = ev;
				channel.id = c.id;
				channel.kind = c.kind;
				channelMap.set(id, channel);
			}
		}
	}
	return channelMap;
};

export const getName = (
	pubkey: string,
	profileMap: Map<string, ProfileContentEvent>,
	eventFollowList: NostrEvent | undefined,
	isNameDisabled?: boolean,
	excludeIcon?: boolean
): string => {
	const prof = profileMap.get(pubkey);
	let name: string | undefined = prof?.name;
	const display_name: string | undefined = prof?.display_name;
	const petname: string | undefined = eventFollowList?.tags
		.find((tag) => tag.length >= 4 && tag[0] === 'p' && tag[1] === pubkey)
		?.at(3);
	const namePrefix: string = excludeIcon ? '' : 'id:';
	const petnamePrefix: string = excludeIcon ? '' : '📛';
	let nameToShow: string | undefined;
	if (isNameDisabled) {
		name = undefined;
	}
	if (petname !== undefined && petname.length > 0) {
		nameToShow = `${petnamePrefix}${petname}`;
	} else if (name !== undefined && name.length > 0) {
		nameToShow = `${namePrefix}${name}`;
	} else if (display_name !== undefined && display_name.length > 0) {
		nameToShow = display_name;
	} else {
		nameToShow = `${namePrefix}${nip19.npubEncode(pubkey)}`;
	}
	const birthday = prof?.birthday;
	const today = new Date();
	if (birthday?.month === today.getMonth() + 1 && birthday.day === today.getDate()) {
		nameToShow = `🎂${nameToShow}`;
	}
	if (nameToShow.length > 20) {
		nameToShow = `${nameToShow.slice(0, 20)}...`;
	}
	return nameToShow;
};

export const getProfileId = (prof: ProfileContent | undefined) => {
	let name = prof?.name !== undefined ? `id:${prof.name}` : 'anonymouse';
	if (name.length > 30) {
		name = `${name.slice(0, 25)}...`;
	}
	return name;
};

export const getNameOfKind = (kind: number): string => {
	const nameMap = new Map<number, string>([
		[1, 'Short Text Note'],
		[6, 'Repost'],
		[16, 'Generic Repost'],
		[20, 'Picture'],
		[40, 'Channel Creation'],
		[42, 'Channel Message'],
		[1068, 'Poll'],
		[1111, 'Comment'],
		[20000, 'Bitchat'],
		[39701, 'Web bookmarks']
	]);
	return nameMap.get(kind) ?? '';
};
