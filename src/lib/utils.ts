import { verifyEvent, type NostrEvent } from 'nostr-tools/pure';
import type { RelayRecord } from 'nostr-tools/relay';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import { defaultRelays } from '$lib/config';
import type { ProfileContent } from 'applesauce-core/helpers';

export interface ProfileContentEvent extends ProfileContent {
	event: NostrEvent;
}

export interface ChannelContent extends nip19.EventPointer {
	name: string;
	about?: string;
	picture?: string;
	relays?: string[];
	pubkey: string;
	created_at: number;
}

export type UrlParams = {
	currentPubkey?: string;
	currentChannelId?: string;
	currentNoteId?: string;
	hashtag?: string;
	query?: string;
	isSettings?: boolean;
	isAntenna?: boolean;
};

export const getRelativetime = (nowRealtime: number, unixTime: number): string => {
	const diff = (nowRealtime - unixTime) / 1000;
	if (diff <= 0) {
		return '今';
	} else if (diff < 60) {
		return `${diff}秒前`;
	} else if (diff < 60 * 60) {
		return `${Math.floor(diff / 60)}分前`;
	} else if (diff < 60 * 60 * 24) {
		return `${Math.floor(diff / (60 * 60))}時間前`;
	} else if (diff < 60 * 60 * 24 * 30) {
		return `${Math.floor(diff / (60 * 60 * 24))}日前`;
	} else if (diff < 60 * 60 * 24 * 30 * 12) {
		return `${Math.floor(diff / (60 * 60 * 24 * 30))}ヶ月前`;
	} else {
		return `${Math.floor(diff / (60 * 60 * 24 * 30 * 12))}年前`;
	}
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

export const getEvent9734 = async (
	event: NostrEvent,
	profile: ProfileContentEvent
): Promise<NostrEvent | null> => {
	if (event.kind !== 9735 || profile.event.pubkey === undefined) {
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

export const splitNip51List = async (
	event: NostrEvent,
	loginPubkey: string
): Promise<{
	pPub: string[];
	ePub: string[];
	wPub: string[];
	pSec: string[];
	eSec: string[];
	wSec: string[];
	tagList: string[][];
	contentList: string[][];
}> => {
	const getList = (tags: string[][], tagName: string): string[] =>
		tags.filter((tag) => tag.length >= 2 && tag[0] === tagName).map((tag) => tag[1]);
	const [pPub, ePub, wPub] = ['p', 'e', 'word'].map((tagName: string) =>
		getList(event.tags, tagName)
	);
	let [pSec, eSec, wSec]: [string[], string[], string[]] = [[], [], []];
	const tagList: string[][] = event.tags;
	let contentList: string[][] = [];
	if (event.content.length > 0 && window.nostr?.nip04 !== undefined) {
		try {
			const content = await window.nostr.nip04.decrypt(loginPubkey, event.content);
			contentList = JSON.parse(content);
		} catch (error) {
			console.warn(error);
		}
		[pSec, eSec, wSec] = ['p', 'e', 'word'].map((tagName: string) => getList(contentList, tagName));
	}
	return { pPub, ePub, wPub, pSec, eSec, wSec, tagList, contentList };
};

export const getPubkeysForFilter = (events: NostrEvent[]): string[] => {
	const pubkeys: Set<string> = new Set();
	for (const ev of events.filter((ev) => ev.kind === 0)) {
		//npubでの言及
		let profile: ProfileContent;
		try {
			profile = JSON.parse(ev.content);
		} catch (error) {
			console.warn(error);
			console.info(ev);
			continue;
		}
		if (!profile.about) continue;
		const matchesIteratorNpub = profile.about.matchAll(/nostr:(npub1\w{58})/g);
		for (const match of matchesIteratorNpub) {
			let d;
			try {
				d = nip19.decode(match[1]);
			} catch (error) {
				console.warn(error);
				console.info(ev);
				continue;
			}
			if (d.type === 'npub') {
				pubkeys.add(d.data);
			}
		}
	}
	for (const ev of events.filter((ev) => [1, 42].includes(ev.kind))) {
		pubkeys.add(ev.pubkey);
		//pタグ送信先
		for (const pubkey of ev.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'p')
			.map((tag) => tag[1])) {
			pubkeys.add(pubkey);
		}
		//npubでの言及
		const matchesIteratorNpub = ev.content.matchAll(/nostr:(npub1\w{58})/g);
		for (const match of matchesIteratorNpub) {
			let d;
			try {
				d = nip19.decode(match[1]);
			} catch (error) {
				console.warn(error);
				console.info(ev);
				continue;
			}
			if (d.type === 'npub') {
				pubkeys.add(d.data);
			}
		}
	}
	return Array.from(pubkeys);
};

export const getIdsForFilter = (
	events: NostrEvent[]
): { ids: string[]; aps: nip19.AddressPointer[] } => {
	const ids: Set<string> = new Set();
	const aps: nip19.AddressPointer[] = [];
	const apsStr: Set<string> = new Set();
	for (const ev of events) {
		let content: string | undefined = undefined;
		if (ev.kind === 0) {
			let profile: ProfileContent;
			try {
				profile = JSON.parse(ev.content);
			} catch (error) {
				console.warn(error);
				console.info(ev);
				continue;
			}
			content = profile.about;
		} else if ([1, 42].includes(ev.kind)) {
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
					ids.add(d.data);
				} else if (d.type === 'nevent') {
					ids.add(d.data.id);
				} else if (d.type === 'naddr') {
					const str = `${d.data.kind}:${d.data.pubkey}:${d.data.identifier}`;
					if (!apsStr.has(str)) {
						aps.push(d.data);
						apsStr.add(str);
					}
				}
			}
		}
		//kind1,42は個別に探索する(スレッドの上限を決めている)
		if (![1, 42].includes(ev.kind)) {
			for (const id of ev.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'e')
				.map((tag) => tag[1])) {
				ids.add(id);
			}
		}
	}
	return { ids: Array.from(ids), aps: aps };
};

export const getRelaysToUseByRelaysSelected = (
	relaysSelected: string,
	eventRelayList?: NostrEvent
): Promise<RelayRecord> => {
	switch (relaysSelected) {
		case 'kind10002': {
			const newRelays: RelayRecord = {};
			for (const tag of eventRelayList?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'r') ??
				[]) {
				newRelays[normalizeURL(tag[1])] = {
					read: tag.length === 2 || tag[2] === 'read',
					write: tag.length === 2 || tag[2] === 'write'
				};
			}
			return Promise.resolve(newRelays);
		}
		case 'nip07':
			if (window.nostr?.getRelays === undefined) return Promise.resolve({});
			return window.nostr.getRelays();
		case 'default':
		default:
			return Promise.resolve(defaultRelays);
	}
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

export const zap = async (npub: string, id: string, relays: string[]): Promise<void> => {
	// @ts-expect-error 型なんて定義されてないよ
	const { initTarget } = await import('nostr-zap/src/view');
	const elm: HTMLButtonElement = document.createElement('button');
	elm.dataset.npub = npub;
	elm.dataset.noteId = id;
	elm.dataset.relays = relays.join(',');
	initTarget(elm);
	elm.dispatchEvent(new Event('click'));
};
