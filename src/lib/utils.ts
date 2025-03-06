import { verifyEvent, type NostrEvent, type VerifiedEvent } from 'nostr-tools/pure';
import type { RelayRecord } from 'nostr-tools/relay';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import { defaultRelays } from '$lib/config';
import { getEventByAddressPointer, getEventById } from '$lib/resource.svelte';
import type { ProfileContent } from 'applesauce-core/helpers';
import data from '@emoji-mart/data';
// @ts-expect-error なんもわからんかも
import type { BaseEmoji } from '@types/emoji-mart';
import { _ } from 'svelte-i18n';
import { get } from 'svelte/store';

export interface ProfileContentEvent extends ProfileContent {
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
	currentChannelId?: string;
	currentEventPointer?: nip19.EventPointer;
	currentAddressPointer?: nip19.AddressPointer;
	hashtag?: string;
	category?: string;
	query?: string;
	urlSearchParams?: URLSearchParams;
	isSettings?: boolean;
	isAntenna?: boolean;
	is404?: boolean;
};

interface MyBaseEmoji extends BaseEmoji {
	shortcodes: string;
	src: string | undefined;
}

export const getAbsoluteTime = (unixTime: number): string => {
	return new Date(1000 * unixTime).toLocaleString();
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

export const getTargetEvent = (ev: NostrEvent): NostrEvent | undefined => {
	const eId = (
		ev.tags.find(
			(tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'reply' && [1, 42].includes(ev.kind)
		) ??
		ev.tags.find(
			(tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root' && ev.kind === 1
		) ??
		ev.tags.find(
			(tag) => tag.length >= 2 && tag[0] === 'e' && [6, 16, 1111, 9735].includes(ev.kind)
		) ??
		ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e' && ev.kind === 7)
	)?.at(1);
	const aId = ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1);
	let targetEvent: NostrEvent | undefined;
	if (eId !== undefined) {
		targetEvent = getEventById(eId);
	} else if (aId !== undefined && [7, 8, 16, 1111].includes(ev.kind)) {
		const ap: nip19.AddressPointer | null = getAddressPointerFromAId(aId);
		targetEvent = ap === null ? undefined : getEventByAddressPointer(ap);
	}
	return targetEvent;
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
	if (event.content.length > 0 && window.nostr?.nip04 !== undefined) {
		try {
			const content = await window.nostr.nip04.decrypt(loginPubkey, event.content);
			contentList = JSON.parse(content);
		} catch (error) {
			console.warn(error);
		}
		[pSec, eSec, wSec, tSec] = ['p', 'e', 'word', 't'].map((tagName: string) =>
			getList(contentList, tagName)
		);
	}
	return { pPub, ePub, wPub, tPub, pSec, eSec, wSec, tSec, tagList, contentList };
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
		} else if ([1, 42, 30023].includes(ev.kind)) {
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
		if (![1, 42, 30023].includes(ev.kind)) {
			for (const id of ev.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'e')
				.map((tag) => tag[1])) {
				ids.add(id);
			}
		}
	}
	return { ids: Array.from(ids), aps: aps };
};

export const getRelaysToUseFromKind10002Event = (event?: NostrEvent): RelayRecord => {
	const newRelays: RelayRecord = {};
	for (const tag of event?.tags.filter(
		(tag) => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1])
	) ?? []) {
		newRelays[normalizeURL(tag[1])] = {
			read: tag.length === 2 || tag[2] === 'read',
			write: tag.length === 2 || tag[2] === 'write'
		};
	}
	return newRelays;
};

export const getRelaysToUseByRelaysSelected = (
	relaysSelected: string,
	eventRelayList?: NostrEvent,
	eventsRelaySets?: NostrEvent[]
): Promise<RelayRecord> => {
	switch (relaysSelected.startsWith('30002:') ? 'kind30002' : relaysSelected) {
		case 'kind10002': {
			const newRelays: RelayRecord = getRelaysToUseFromKind10002Event(eventRelayList);
			return Promise.resolve(newRelays);
		}
		case 'kind30002': {
			const [kind, pubkey, dTag] = relaysSelected.split(':');
			const eventRelaySets = (
				eventsRelaySets?.filter(
					(ev) =>
						ev.kind === parseInt(kind) &&
						ev.pubkey === pubkey &&
						(ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '') === dTag
				) ?? []
			).at(0);
			const newRelays: RelayRecord = {};
			for (const tag of eventRelaySets?.tags.filter(
				(tag) => tag.length >= 2 && tag[0] === 'relay' && URL.canParse(tag[1])
			) ?? []) {
				newRelays[normalizeURL(tag[1])] = {
					read: true,
					write: true
				};
			}
			return Promise.resolve(newRelays);
		}
		case 'default':
		default: {
			return Promise.resolve(defaultRelays);
		}
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

export const zap = async (
	npub: string,
	id: string,
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
	elm.dataset.noteId = id;
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
	onClose: () => void = () => {}
): Promise<{ emojiStr: string; emojiUrl: string | undefined } | null> => {
	const { Picker } = await import('emoji-mart');
	return new Promise((resolve) => {
		if (emojiPickerContainer.children.length > 0) {
			resolve(null);
			return;
		}
		const close = () => {
			emojiPickerContainer.firstChild?.remove();
			onClose();
		};
		const onEmojiSelect = (emoji: MyBaseEmoji) => {
			close();
			const emojiStr = emoji.native ?? emoji.shortcodes;
			const emojiUrl = emoji.src;
			resolve({ emojiStr, emojiUrl });
		};
		const onClickOutside = () => {
			close();
			resolve(null);
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

const indexOfFirstUnmatchingCloseParen = (url: string): number => {
	let nest = 0;
	for (let i = 0; i < url.length; i++) {
		const c = url.charAt(i);
		if (c === '(') {
			nest++;
		} else if (c === ')') {
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
	const splitIdx: number = indexOfFirstUnmatchingCloseParen(url);
	const finalUrl: string = splitIdx === -1 ? url : url.substring(0, splitIdx);
	const rest = splitIdx === -1 ? '' : url.substring(splitIdx);
	return [finalUrl, rest];
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
