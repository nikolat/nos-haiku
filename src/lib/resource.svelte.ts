import { bufferTime, Subscription, merge, debounceTime } from 'rxjs';
import {
	batch,
	completeOnTimeout,
	createRxBackwardReq,
	createRxForwardReq,
	createRxNostr,
	createTie,
	filterByKind,
	latestEach,
	type EventPacket,
	type LazyFilter,
	type MergeFilter,
	type RxNostrSendOptions,
	type RxNostrUseOptions
} from 'rx-nostr';
import { verifier } from 'rx-nostr-crypto';
import { EventStore } from 'applesauce-core';
import { unixNow, getProfileContent, type ProfileContent } from 'applesauce-core/helpers';
import {
	getEventHash,
	sortEvents,
	type EventTemplate,
	type NostrEvent,
	type UnsignedEvent,
	type VerifiedEvent
} from 'nostr-tools/pure';
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
import { normalizeURL } from 'nostr-tools/utils';
import type { Filter } from 'nostr-tools/filter';
import type { RelayRecord } from 'nostr-tools/relay';
import type { WindowNostr } from 'nostr-tools/nip07';
import * as nip19 from 'nostr-tools/nip19';
import type { FileUploadResponse } from 'nostr-tools/nip96';
import { locale } from 'svelte-i18n';
import {
	clientTag,
	defaultReactionToAdd,
	defaultRelays,
	initialLocale,
	profileRelays,
	searchRelays,
	subRelaysForChannel,
	uploaderURLs
} from '$lib/config';
import { preferences } from '$lib/store';
import {
	getAddressPointerFromAId,
	getEvent9734,
	getIdsForFilter,
	getPubkeysForFilter,
	getRelaysToUseByRelaysSelected,
	isValidEmoji,
	splitNip51List,
	splitNip51ListPublic,
	urlLinkString,
	type ChannelContent,
	type ProfileContentEvent,
	type UrlParams
} from '$lib/utils';

let loginPubkey: string | undefined = $state();
let lang: string = $state(initialLocale);
let isEnabledDarkMode: boolean = $state(true);
let isEnabledRelativeTime: boolean = $state(true);
let isEnabledSkipKind1: boolean = $state(false);
let isEnabledUseClientTag: boolean = $state(false);
let relaysSelected: string = $state('default');
let uploaderSelected: string = $state(uploaderURLs[0]);
let relaysToUse: RelayRecord = $state(defaultRelays);
const relaysToUseForProfile: string[] = $derived([
	...Object.entries(relaysToUse)
		.filter((v) => v[1].read)
		.map((v) => v[0]),
	...profileRelays
]);
const relaysToUseForChannelMeta: string[] = $derived([
	...Object.entries(relaysToUse)
		.filter((v) => v[1].read)
		.map((v) => v[0]),
	...subRelaysForChannel
]);
const relaysToRead: string[] = $derived(
	Object.entries(relaysToUse)
		.filter((v) => v[1].read)
		.map((v) => v[0])
);
const relaysToWrite: string[] = $derived(
	Object.entries(relaysToUse)
		.filter((v) => v[1].write)
		.map((v) => v[0])
);

preferences.subscribe(
	(value: {
		loginPubkey: string | undefined;
		lang: string;
		isEnabledDarkMode: boolean;
		isEnabledRelativeTime: boolean;
		isEnabledSkipKind1: boolean;
		isEnabledUseClientTag: boolean;
		relaysSelected: string;
		uploaderSelected: string;
		relaysToUse: RelayRecord;
	}) => {
		if (loginPubkey !== value.loginPubkey) {
			loginPubkey = value.loginPubkey;
		}
		if (lang !== value.lang) {
			lang = value.lang;
		}
		if (isEnabledDarkMode !== value.isEnabledDarkMode) {
			isEnabledDarkMode = value.isEnabledDarkMode;
		}
		if (isEnabledRelativeTime !== value.isEnabledRelativeTime) {
			isEnabledRelativeTime = value.isEnabledRelativeTime;
		}
		if (isEnabledSkipKind1 !== value.isEnabledSkipKind1) {
			isEnabledSkipKind1 = value.isEnabledSkipKind1;
		}
		if (isEnabledUseClientTag !== value.isEnabledUseClientTag) {
			isEnabledUseClientTag = value.isEnabledUseClientTag;
		}
		if (relaysSelected !== value.relaysSelected) {
			relaysSelected = value.relaysSelected;
		}
		if (uploaderSelected !== value.uploaderSelected) {
			uploaderSelected = value.uploaderSelected;
		}
		if (JSON.stringify(relaysToUse) !== JSON.stringify(value.relaysToUse)) {
			relaysToUse = value.relaysToUse;
		}
	}
);
const savelocalStorage = () => {
	preferences.set({
		loginPubkey,
		lang,
		isEnabledDarkMode,
		isEnabledRelativeTime,
		isEnabledSkipKind1,
		isEnabledUseClientTag,
		relaysSelected,
		uploaderSelected,
		relaysToUse
	});
};

const secBufferTime = 1000;
const secOnCompleteTimeout = 3000;

declare global {
	interface Window {
		nostr?: WindowNostr;
	}
}

//深いリプライツリーはある程度で探索を打ち切る(暫定処理)
let countThread: Map<string, number> = new Map<string, number>();
const countThreadLimit = 5;

const eventStore = new EventStore();
const rxNostr = createRxNostr({ verifier, authenticator: 'auto' });
const [tie, seenOn] = createTie();
let subF: Subscription;

let eventsMention: NostrEvent[] = $state([]);
let eventsProfile: NostrEvent[] = $state([]);
let eventsChannel: NostrEvent[] = $state([]);
let eventsChannelEdit: NostrEvent[] = $state([]);
let eventsTimeline: NostrEvent[] = $state([]);
let eventsChannelBookmark: NostrEvent[] = $state([]);
let eventsReaction: NostrEvent[] = $state([]);
let eventFollowList: NostrEvent | undefined = $state();
let eventsRelaySets: NostrEvent[] = $state([]);
let eventRead: NostrEvent | undefined = $state();
let eventMuteList: NostrEvent | undefined;
let eventRelayList: NostrEvent | undefined;
let eventMyPublicChatsList: NostrEvent | undefined;
let eventEmojiSetList: NostrEvent | undefined;
let eventsEmojiSet: NostrEvent[] = $state([]);
let eventsDeletion: NostrEvent[] = [];
let eventsAll: NostrEvent[] = $state([]);
let mutedPubkeys: string[] = $state([]);
let mutedChannelIds: string[] = $state([]);
let mutedWords: string[] = $state([]);
let mutedHashTags: string[] = $state([]);
let myBookmarkedChannelIds: string[] = $state([]);

const profileMap: Map<string, ProfileContentEvent> = $derived.by(() => {
	const eventMap = new Map<string, NostrEvent>();
	const profileMap = new Map<string, ProfileContentEvent>();
	const eventsProfileSorted = eventsProfile.toSorted((a, b) => {
		const fn = (ev: NostrEvent): number =>
			Array.from(eventStore.getAll([{ authors: [ev.pubkey], kinds: [1, 42] }])).at(0)?.created_at ??
			-1 * Infinity;
		return fn(b) - fn(a);
	});
	for (const ev of eventsProfileSorted) {
		const event = eventMap.get(ev.pubkey);
		if (event === undefined || (event !== undefined && event.created_at < ev.created_at)) {
			eventMap.set(ev.pubkey, ev);
			let pc: ProfileContent;
			try {
				pc = getProfileContent(ev);
			} catch (_error) {
				continue;
			}
			profileMap.set(ev.pubkey, { ...pc, event: ev });
		}
	}
	return profileMap;
});

const channelMap = $derived.by(() => {
	const channelMap = new Map<string, ChannelContent>();
	const getCategories = (event: NostrEvent): string[] =>
		Array.from(
			new Set<string>(
				event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 't' && /^[^\s#]+$/.test(tag[1]))
					.map((tag) => tag[1].toLowerCase())
			)
		);
	for (const ev of eventsChannel) {
		let channel: ChannelContent;
		try {
			channel = JSON.parse(ev.content);
		} catch (error) {
			console.warn(error);
			continue;
		}
		channel.relays = channel.relays
			?.filter((relay) => URL.canParse(relay))
			.map((relay) => normalizeURL(relay));
		channel.categories = getCategories(ev);
		channel.eventkind40 = ev;
		channel.id = ev.id;
		channel.kind = ev.kind;
		channel.pubkey = ev.pubkey;
		channel.author = ev.pubkey;
		channel.created_at = ev.created_at;
		channelMap.set(ev.id, channel);
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
				let channel: ChannelContent;
				try {
					channel = JSON.parse(ev.content);
				} catch (error) {
					console.warn(error);
					continue;
				}
				channel.relays = channel.relays
					?.filter((relay) => URL.canParse(relay))
					.map((relay) => normalizeURL(relay));
				channel.categories = getCategories(ev);
				channel.eventkind40 = c.eventkind40;
				channel.eventkind41 = ev;
				channel.id = c.id;
				channel.kind = c.kind;
				channel.pubkey = c.pubkey;
				channel.author = c.pubkey;
				channel.created_at = ev.created_at;
				channelMap.set(id, channel);
			}
		}
	}
	return channelMap;
});

const channelEventMap = $derived(
	new Map<string, NostrEvent>(eventsChannel.map((ev) => [ev.id, ev]))
);

const channelBookmarkMap = $derived.by(() => {
	const eventMap = new Map<string, NostrEvent>();
	const channelBookmarkMap = new Map<string, string[]>();
	for (const ev of eventsChannelBookmark) {
		const event = eventMap.get(ev.pubkey);
		if (event === undefined || (event !== undefined && event.created_at < ev.created_at)) {
			eventMap.set(ev.pubkey, ev);
			channelBookmarkMap.set(
				ev.pubkey,
				ev.tags.filter((tag) => tag.length >= 2 && tag[0] === 'e').map((tag) => tag[1])
			);
		}
	}
	return channelBookmarkMap;
});

//====================[変数にアクセスする手段を提供]====================

export const getProfileId = (prof: ProfileContent | undefined) => {
	let name = prof?.name !== undefined ? `id:${prof.name}` : 'anonymouse';
	if (name.length > 30) {
		name = `${name.slice(0, 25)}...`;
	}
	return name;
};

export const getProfileName = (pubkey: string) => {
	const prof = profileMap.get(pubkey);
	let name = prof?.display_name || (prof?.name !== undefined ? `id:${prof?.name}` : 'anonymouse');
	if (eventFollowList !== undefined) {
		const petname = eventFollowList.tags
			.find((tag) => tag.length >= 4 && tag[0] === 'p' && tag[1] === pubkey)
			?.at(3);
		if (petname !== undefined) {
			name = `📛${petname}`;
		}
	}
	if (name.length > 30) {
		name = `${name.slice(0, 25)}...`;
	}
	return name;
};

export const getLoginPubkey = (): string | undefined => {
	return loginPubkey;
};

export const setLoginPubkey = (value: string | undefined): void => {
	loginPubkey = value;
	savelocalStorage();
};

export const getRelaysSelected = (): string => {
	return relaysSelected;
};

export const setRelaysSelected = (value: string): void => {
	relaysSelected = value;
	savelocalStorage();
};

export const getUploaderSelected = (): string => {
	return uploaderSelected;
};

export const setUploaderSelected = (value: string): void => {
	uploaderSelected = value;
	savelocalStorage();
};

export const getLang = (): string => {
	return lang;
};

export const setLang = (value: string): void => {
	lang = value;
	locale.set(value);
	savelocalStorage();
};

export const getIsEnabledDarkMode = (): boolean => {
	return isEnabledDarkMode;
};

export const setIsEnabledDarkMode = (value: boolean): void => {
	isEnabledDarkMode = value;
	savelocalStorage();
};

export const getIsEnabledRelativeTime = (): boolean => {
	return isEnabledRelativeTime;
};

export const setIsEnabledRelativeTime = (value: boolean): void => {
	isEnabledRelativeTime = value;
	savelocalStorage();
};

export const getIsEnabledSkipKind1 = (): boolean => {
	return isEnabledSkipKind1;
};

export const setIsEnabledSkipKind1 = (value: boolean): void => {
	isEnabledSkipKind1 = value;
	savelocalStorage();
};

export const getIsEnabledUseClientTag = (): boolean => {
	return isEnabledUseClientTag;
};

export const setIsEnabledUseClientTag = (value: boolean): void => {
	isEnabledUseClientTag = value;
	savelocalStorage();
};

export const getRelaysToUse = (): RelayRecord => {
	return relaysToUse;
};

export const resetRelaysDefault = (): void => {
	relaysSelected = 'default';
	relaysToUse = defaultRelays;
	savelocalStorage();
};

export const setRelaysToUseSelected = async (relaysSelected: string): Promise<void> => {
	relaysToUse = await getRelaysToUseByRelaysSelected(
		relaysSelected,
		eventRelayList,
		eventsRelaySets
	);
	savelocalStorage();
};

export const clearCache = (
	filters: Filter[] = [{ kinds: [1, 3, 6, 7, 16, 42, 10000, 10001, 10030, 30002, 30008, 30078] }]
) => {
	for (const ev of eventStore.getAll(filters)) {
		eventStore.database.removeEvent(ev);
	}
	if (loginPubkey !== undefined) {
		const ev = eventStore.getReplaceable(10005, loginPubkey);
		if (ev !== undefined) {
			eventStore.database.removeEvent(ev);
		}
	}
	eventsTimeline = [];
	eventsMention = [];
	eventFollowList = undefined;
	eventMuteList = undefined;
	eventMyPublicChatsList = undefined;
	eventEmojiSetList = undefined;
	eventsRelaySets = [];
	eventRead = undefined;
	mutedPubkeys = [];
	mutedChannelIds = [];
	mutedWords = [];
	mutedHashTags = [];
	myBookmarkedChannelIds = [];
	subF?.unsubscribe();
	seenOn.clear();
};

export const getEventsMention = (): NostrEvent[] => {
	return eventsMention;
};

export const getEventsTimelineTop = (): NostrEvent[] => {
	return eventsTimeline;
};

export const getEventsChannel = (): NostrEvent[] => {
	return eventsChannel;
};

export const getChannelMap = (): Map<string, ChannelContent> => {
	return channelMap;
};

export const getChannelEventMap = (): Map<string, NostrEvent> => {
	return channelEventMap;
};

export const getChannelBookmarkMap = (): Map<string, string[]> => {
	return channelBookmarkMap;
};

export const getProfileMap = (): Map<string, ProfileContentEvent> => {
	return profileMap;
};

export const getEventsReaction = (): NostrEvent[] => {
	return eventsReaction;
};

const eventsEmojiSetLatest: NostrEvent[] = $derived.by(() => {
	const eventMap: Map<string, NostrEvent> = new Map<string, NostrEvent>();
	for (const ev of eventsEmojiSet) {
		const s = `${ev.kind}:${ev.pubkey}:${ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`;
		const event = eventMap.get(s);
		if (event === undefined || ev.created_at > event.created_at) {
			eventMap.set(s, ev);
		}
	}
	return Array.from(eventMap.values());
});

export const getEventsEmojiSet = (): NostrEvent[] => {
	return eventsEmojiSetLatest;
};

export const getEventById = (id: string): NostrEvent | undefined => {
	return eventsAll.find((ev) => ev.id === id);
};

export const getEventsByFilter = (
	kindSet: Set<number>,
	authorSet: Set<string>,
	query?: string
): NostrEvent[] => {
	return eventsAll.filter(
		(ev) =>
			(kindSet.size === 0 || kindSet.has(ev.kind)) &&
			(authorSet.size === 0 || authorSet.has(ev.pubkey)) &&
			(query === undefined || ev.content.includes(query))
	);
};

export const getEventsReplying = (event: NostrEvent): NostrEvent[] => {
	const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
	return eventsAll
		.filter(
			(ev) =>
				([1, 42].includes(event.kind) &&
					[1, 42].includes(ev.kind) &&
					ev.tags.some(
						(tag) =>
							tag.length >= 4 &&
							tag[0] === 'e' &&
							tag[1] === event.id &&
							(tag[3] === 'reply' || (tag[3] === 'root' && ev.kind === 1))
					)) ||
				(![1, 42].includes(event.kind) &&
					ev.kind === 1111 &&
					ev.tags.some(
						(tag) =>
							tag.length >= 2 &&
							((tag[0] === 'a' && tag[1] === `${event.kind}:${event.pubkey}:${d}`) ||
								(tag[0] === 'e' && tag[1] === event.id))
					))
		)
		.filter(
			(ev) =>
				!(
					ev.tags.some(
						(tag) => tag.length >= 4 && tag[0] === 'e' && tag[1] === event.id && tag[3] === 'root'
					) && ev.tags.some((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'reply')
				)
		);
};

export const getEventByAddressPointer = (data: nip19.AddressPointer): NostrEvent | undefined => {
	return eventsAll.find(
		(ev) =>
			ev.pubkey === data.pubkey &&
			ev.kind === data.kind &&
			(ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '') === data.identifier
	);
};

export const getMutedPubkeys = (): string[] => {
	return mutedPubkeys;
};

export const getMutedChannelIds = (): string[] => {
	return mutedChannelIds;
};

export const getMutedWords = (): string[] => {
	return mutedWords;
};

export const getMutedHashTags = (): string[] => {
	return mutedHashTags;
};

export const getFollowList = (): NostrEvent | undefined => {
	return eventFollowList;
};

export const getRelaySets = (): NostrEvent[] => {
	return eventsRelaySets;
};

export const getReadTimeOfNotification = (): number => {
	return eventRead?.created_at ?? 0;
};

export const getSeenOn = (id: string): string[] => {
	const s = seenOn.get(id);
	if (s === undefined) {
		return [];
	}
	return Array.from(s).map((url) => normalizeURL(url));
};

//====================[受信したイベントの処理]====================

const nextOnSubscribeEventStore = (event: NostrEvent | null, kindToDelete?: number) => {
	const kind = kindToDelete !== undefined ? kindToDelete : event?.kind;
	switch (kind) {
		case 0: {
			eventsProfile = Array.from(eventStore.getAll([{ kinds: [0] }]));
			break;
		}
		case 3: {
			if (loginPubkey !== undefined) {
				eventFollowList = eventStore.getReplaceable(3, loginPubkey);
			}
			break;
		}
		case 5: {
			eventsDeletion = sortEvents(Array.from(eventStore.getAll([{ kinds: [5] }])));
			const kinds = event?.tags
				.filter((tag) => tag.length >= 2 && tag[0] === 'k')
				.map((tag) => parseInt(tag[1]));
			for (const k of kinds ?? []) {
				nextOnSubscribeEventStore(null, k);
			}
			break;
		}
		case 7: {
			eventsReaction = sortEvents(Array.from(eventStore.getAll([{ kinds: [7] }])));
			break;
		}
		case 40: {
			eventsChannel = sortEvents(Array.from(eventStore.getAll([{ kinds: [40] }])));
			break;
		}
		case 41: {
			eventsChannelEdit = sortEvents(Array.from(eventStore.getAll([{ kinds: [41] }])));
			break;
		}
		case 1:
		case 6:
		case 8:
		case 16:
		case 42:
		case 1068:
		case 1111:
		case 9735: {
			if (
				(kind === 8 &&
					(loginPubkey === undefined ||
						(loginPubkey !== undefined &&
							event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'p')?.at(1) !==
								loginPubkey))) ||
				(kind === 16 &&
					event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'k')?.at(1) !== '42') ||
				(kind === 9735 &&
					(loginPubkey === undefined ||
						(loginPubkey !== undefined &&
							event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'P')?.at(1) !== loginPubkey)))
			) {
				break;
			}
			eventsTimeline = sortEvents(
				Array.from(
					eventStore.getAll(
						loginPubkey === undefined
							? [{ kinds: isEnabledSkipKind1 ? [16, 42, 1111] : [1, 6, 16, 42, 1068, 1111] }]
							: [
									{ kinds: isEnabledSkipKind1 ? [16, 42, 1111] : [1, 6, 16, 42, 1068, 1111] },
									{ kinds: [8], '#p': [loginPubkey] },
									{ kinds: [9735], '#P': [loginPubkey] }
								]
					)
				)
			);
			break;
		}
		case 10000: {
			if (loginPubkey !== undefined) {
				eventMuteList = eventStore.getReplaceable(10000, loginPubkey);
			}
			break;
		}
		case 10002: {
			if (loginPubkey !== undefined) {
				eventRelayList = eventStore.getReplaceable(10002, loginPubkey);
			}
			break;
		}
		case 10005: {
			eventsChannelBookmark = sortEvents(Array.from(eventStore.getAll([{ kinds: [10005] }])));
			if (loginPubkey !== undefined) {
				eventMyPublicChatsList = eventStore.getReplaceable(10005, loginPubkey);
			}
			break;
		}
		case 10030: {
			if (loginPubkey !== undefined) {
				eventEmojiSetList = eventStore.getReplaceable(10030, loginPubkey);
				if (eventEmojiSetList !== undefined) {
					const events30030 = sortEvents(Array.from(eventStore.getAll([{ kinds: [30030] }])));
					const aTags = eventEmojiSetList.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 'a')
						.map((tag) => tag[1]);
					eventsEmojiSet = events30030.filter((ev) =>
						aTags.includes(
							`${ev.kind}:${ev.pubkey}:${ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`
						)
					);
				}
			}
			break;
		}
		case 30002: {
			if (loginPubkey !== undefined) {
				const ds = Array.from(eventStore.getAll([{ kinds: [30002], authors: [loginPubkey] }]))
					.map((ev) => ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1))
					.filter((d) => d !== undefined);
				const events: NostrEvent[] = [];
				for (const d of new Set(ds)) {
					const event = eventStore.getReplaceable(30002, loginPubkey, d);
					if (event !== undefined) {
						events.push(event);
					}
				}
				eventsRelaySets = sortEvents(events);
			}
			break;
		}
		case 30030: {
			if (loginPubkey !== undefined && eventEmojiSetList !== undefined) {
				const events30030 = sortEvents(Array.from(eventStore.getAll([{ kinds: [30030] }])));
				const aTags = eventEmojiSetList.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'a')
					.map((tag) => tag[1]);
				eventsEmojiSet = events30030.filter((ev) =>
					aTags.includes(
						`${ev.kind}:${ev.pubkey}:${ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? ''}`
					)
				);
			}
			break;
		}
		case 30078: {
			if (loginPubkey !== undefined) {
				eventRead = eventStore.getReplaceable(30078, loginPubkey, 'nostter-read');
			}
			break;
		}
		default:
			break;
	}
	if (loginPubkey !== undefined) {
		eventsMention = sortEvents(
			Array.from(
				eventStore.getAll(
					isEnabledSkipKind1
						? [
								{ '#p': [loginPubkey], kinds: [4, 8, 16, 42, 1111, 9735] },
								{ '#p': [loginPubkey], kinds: [7], '#k': ['42', '1111'] }
							]
						: [{ '#p': [loginPubkey], kinds: [1, 4, 6, 7, 8, 16, 42, 1111, 9735] }]
				)
			)
		).filter(
			(ev) =>
				!(
					ev.kind === 7 &&
					ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'p')?.at(1) !== loginPubkey
				)
		);
	}
	eventsAll = Array.from(eventStore.getAll([{ until: unixNow() }]));
};

eventStore
	.filters([
		{
			since: 0
		}
	])
	.subscribe(nextOnSubscribeEventStore);

const getDeletedEventIdSet = (eventsDeletion: NostrEvent[]): Set<string> => {
	const deletedEventIdSet = new Set<string>();
	for (const ev of eventsDeletion) {
		const ids: string[] = ev.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'e')
			.map((tag) => tag[1]);
		for (const id of ids) {
			deletedEventIdSet.add(id);
		}
	}
	return deletedEventIdSet;
};

const next = (packet: EventPacket) => {
	const event = packet.event;
	if (eventStore.hasEvent(event.id)) {
		console.info('kind', event.kind, 'duplicated');
		return;
	}
	if (getDeletedEventIdSet(eventsDeletion).has(event.id)) {
		console.info('kind', event.kind, 'deleted');
		return;
	}
	eventStore.add(event);
	console.info('kind', event.kind);
	if (event.kind === 5) {
		const ids: string[] = event.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'e')
			.map((tag) => tag[1]);
		for (const id of ids) {
			if (eventStore.hasEvent(id)) {
				eventStore.database.removeEvent(id);
			}
		}
	}
};
const complete = () => {};

const mergeFilter0: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
	const margedFilters = [...a, ...b];
	const authors = Array.from(new Set<string>(margedFilters.map((f) => f.authors ?? []).flat()));
	const f = margedFilters.at(0);
	return [{ kinds: [0], authors: authors, limit: f?.limit, until: f?.until, since: f?.since }];
};

const mergeFilter7: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
	const margedFilters = [...a, ...b];
	const etags = Array.from(new Set<string>(margedFilters.map((f) => f['#e'] ?? []).flat()));
	const atags = Array.from(new Set<string>(margedFilters.map((f) => f['#a'] ?? []).flat()));
	const f = margedFilters.at(0);
	const r: LazyFilter[] = [];
	if (etags.length > 0) {
		r.push({ kinds: [7], '#e': etags, limit: f?.limit, until: f?.until });
	}
	if (atags.length > 0) {
		r.push({ kinds: [7], '#a': atags, limit: f?.limit, until: f?.until });
	}
	return r;
};

const mergeFilter40: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
	const margedFilters = [...a, ...b];
	const ids = Array.from(new Set<string>(margedFilters.map((f) => f.ids ?? []).flat()));
	const f = margedFilters.at(0);
	return [{ kinds: [40], ids: ids, limit: f?.limit, until: f?.until, since: f?.since }];
};

const mergeFilter41: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
	const margedFilters = [...a, ...b];
	const etags = Array.from(new Set<string>(margedFilters.map((f) => f['#e'] ?? []).flat()));
	const f = margedFilters.at(0);
	return [{ kinds: [41], '#e': etags, limit: f?.limit, until: f?.until, since: f?.since }];
};

const mergeFilterForAddressableEvents = (
	a: LazyFilter[],
	b: LazyFilter[],
	kind: number
): LazyFilter[] => {
	const margedFilters = [...a, ...b];
	const newFilters: LazyFilter[] = [];
	const filterMap: Map<string, Set<string>> = new Map<string, Set<string>>();
	for (const filter of margedFilters) {
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
		const filter = { kinds: [kind], authors: [author], '#d': Array.from(dTagSet) };
		newFilters.push(filter);
	}
	return newFilters;
};

const mergeFilterId: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
	const margedFilters = [...a, ...b];
	const ids = Array.from(new Set<string>(margedFilters.map((f) => f.ids ?? []).flat()));
	const f = margedFilters.at(0);
	return [{ ids: ids, limit: f?.limit, until: f?.until, since: f?.since }];
};

const rxReqF = createRxForwardReq();
const rxReqB0 = createRxBackwardReq();
const rxReqB1_42_1111 = createRxBackwardReq();
const rxReqB7 = createRxBackwardReq();
const rxReqB40 = createRxBackwardReq();
const rxReqB41 = createRxBackwardReq();
const rxReqBId = createRxBackwardReq();
const rxReqBRp = createRxBackwardReq();
const batchedReq0 = rxReqB0.pipe(bufferTime(secBufferTime), batch(mergeFilter0));
rxNostr
	.use(batchedReq0, { relays: relaysToUseForProfile })
	.pipe(
		tie,
		latestEach(({ event }) => event.pubkey)
	)
	.subscribe({
		next,
		complete
	});
rxNostr.use(rxReqB1_42_1111).pipe(tie).subscribe({
	next,
	complete
});
const batchedReq7 = rxReqB7.pipe(bufferTime(secBufferTime), batch(mergeFilter7));
rxNostr.use(batchedReq7).pipe(tie).subscribe({
	next,
	complete
});
const batchedReq40 = rxReqB40.pipe(bufferTime(secBufferTime), batch(mergeFilter40));
rxNostr.use(batchedReq40, { relays: relaysToUseForChannelMeta }).pipe(tie).subscribe({
	next,
	complete
});
const batchedReq41 = rxReqB41.pipe(bufferTime(secBufferTime), batch(mergeFilter41));
rxNostr
	.use(batchedReq41, { relays: relaysToUseForChannelMeta })
	.pipe(
		tie,
		latestEach(
			({ event }) =>
				`${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1) ?? ''}`
		)
	)
	.subscribe({
		next,
		complete
	});
const batchedReqId = rxReqBId.pipe(bufferTime(secBufferTime), batch(mergeFilterId));
rxNostr.use(batchedReqId).pipe(tie).subscribe({
	next,
	complete
});
rxNostr.use(rxReqBRp).pipe(tie).subscribe({
	next,
	complete
});

const getEventsByIdWithRelayHint = (
	event: NostrEvent,
	tagNameToGet: string,
	onlyLastOne: boolean = false
) => {
	if (['e', 'q'].includes(tagNameToGet)) {
		let eTags = event.tags.filter((tag) => tag.length >= 3 && tag[0] === tagNameToGet);
		if (onlyLastOne) {
			eTags = [eTags.at(-1) ?? []];
		}
		for (const eTag of eTags) {
			const id = eTag[1];
			const relayHint = eTag[2];
			if (eventStore.hasEvent(id) || relayHint === undefined || !URL.canParse(relayHint)) {
				continue;
			}
			const relay = normalizeURL(relayHint);
			if (relaysToRead.includes(relay)) {
				continue;
			}
			const rxReqBIdCustom = createRxBackwardReq();
			const batchedReqIdCustom = rxReqBIdCustom.pipe(
				bufferTime(secBufferTime),
				batch(mergeFilterId)
			);
			rxNostr
				.use(batchedReqIdCustom, { relays: [relay] })
				.pipe(tie, completeOnTimeout(secOnCompleteTimeout))
				.subscribe({
					next,
					complete
				});
			rxReqBIdCustom.emit({ ids: [id], until: unixNow() });
			rxReqBIdCustom.over();
		}
	} else if (tagNameToGet === 'a') {
		let aTags = event.tags.filter((tag) => tag.length >= 3 && tag[0] === tagNameToGet);
		if (onlyLastOne) {
			aTags = [aTags.at(-1) ?? []];
		}
		for (const aTag of aTags) {
			const ap: nip19.AddressPointer | null = getAddressPointerFromAId(aTag[1]);
			const relayHint = aTag[2];
			if (
				ap === null ||
				eventStore.hasReplaceable(ap.kind, ap.pubkey, ap.identifier) ||
				relayHint === undefined ||
				!URL.canParse(relayHint)
			) {
				continue;
			}
			const relay = normalizeURL(relayHint);
			if (relaysToRead.includes(relay)) {
				continue;
			}
			const rxReqBRpCustom = createRxBackwardReq();
			rxNostr
				.use(rxReqBRpCustom, { relays: [relay] })
				.pipe(tie, completeOnTimeout(secOnCompleteTimeout))
				.subscribe({
					next,
					complete
				});
			const filter: LazyFilter = {
				kinds: [ap.kind],
				authors: [ap.pubkey],
				until: unixNow()
			};
			if (ap.identifier.length > 0) {
				filter['#d'] = [ap.identifier];
			}
			rxReqBRpCustom.emit(filter);
			rxReqBRpCustom.over();
		}
	}
};

//content内の nostr: による参照を探して取得する
const getEventsQuoted = (event: NostrEvent) => {
	const { ids, aps } = getIdsForFilter([event]);
	const idsFiltered = ids.filter((id) => !eventStore.hasEvent(id));
	const apsFiltered = aps.filter(
		(ap) => !eventStore.hasReplaceable(ap.kind, ap.pubkey, ap.identifier)
	);
	const pubkeys = getPubkeysForFilter([event]);
	const pubkeysFilterd = pubkeys.filter((pubkey) => !profileMap.has(pubkey));
	if (idsFiltered.length > 0) {
		rxReqBId.emit({ ids: idsFiltered, until: unixNow() });
	}
	if (apsFiltered.length > 0) {
		for (const ap of apsFiltered) {
			const f: LazyFilter = {
				kinds: [ap.kind],
				authors: [ap.pubkey],
				until: unixNow()
			};
			if (ap.identifier.length > 0) {
				f['#d'] = [ap.identifier];
			}
			rxReqBRp.emit(f);
		}
	}
	if (pubkeysFilterd.length > 0) {
		rxReqB0.emit({ kinds: [0], authors: pubkeysFilterd, until: unixNow() });
	}
	//リレーヒント付き引用による取得
	getEventsByIdWithRelayHint(event, 'q');
	getEventsByIdWithRelayHint(event, 'a');
};

const fetchEventsByETags = (event: NostrEvent, onlyLastOne: boolean = false) => {
	let ids = event.tags
		.filter((tag) => tag.length >= 2 && tag[0] === 'e')
		.map((tag) => tag[1])
		.filter((id) => !eventStore.hasEvent(id));
	if (ids.length > 0) {
		getEventsByIdWithRelayHint(event, 'e', onlyLastOne);
		const lastOne: string | undefined = ids.at(-1);
		if (onlyLastOne && lastOne !== undefined) {
			ids = [lastOne];
		}
		rxReqBId.emit({ ids, until: unixNow() });
	}
};

const fetchEventsByATags = (event: NostrEvent) => {
	const aIds = event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'a').map((tag) => tag[1]);
	const filters = [];
	if (aIds.length > 0) {
		for (const aId of aIds) {
			const ap: nip19.AddressPointer | null = getAddressPointerFromAId(aId);
			if (ap !== null && !eventStore.hasReplaceable(ap.kind, ap.pubkey, ap.identifier)) {
				const filter: LazyFilter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until: unixNow()
				};
				if (ap.identifier.length > 0) {
					filter['#d'] = [ap.identifier];
				}
				filters.push(filter);
			}
		}
		let margedFilters: LazyFilter[] = [];
		for (const filter of filters) {
			margedFilters = mergeFilterForAddressableEvents(
				margedFilters,
				[filter],
				filter.kinds?.at(0) ?? -1
			);
		}
		const sliceByNumber = (array: LazyFilter[], number: number) => {
			const length = Math.ceil(array.length / number);
			return new Array(length)
				.fill(undefined)
				.map((_, i) => array.slice(i * number, (i + 1) * number));
		};
		const relayHints: string[] = Array.from(
			new Set<string>(
				event.tags
					.filter((tag) => tag.length >= 3 && tag[0] === 'a' && URL.canParse(tag[2]))
					.map((tag) => normalizeURL(tag[2]))
			)
		);
		const relays: string[] = Array.from(new Set<string>([...relaysToRead, ...relayHints]));
		for (const filters of sliceByNumber(margedFilters, 10)) {
			rxReqBRp.emit(filters, { relays });
		}
	}
};

const _subTimeline = eventStore
	.filters([
		{
			since: 0
		}
	])
	.subscribe(async (event) => {
		if (![0].includes(event.kind) && !profileMap.has(event.pubkey)) {
			rxReqB0.emit({ kinds: [0], authors: [event.pubkey], until: unixNow() });
		}
		switch (event.kind) {
			case 0: {
				const ids = getIdsForFilter([event]).ids.filter((id) => !eventStore.hasEvent(id));
				const pubkeys = getPubkeysForFilter([event]).filter((pubkey) => !profileMap.has(pubkey));
				if (ids.length > 0) {
					rxReqBId.emit({ ids: ids, until: unixNow() });
				}
				if (pubkeys.length > 0) {
					rxReqB0.emit({ kinds: [0], authors: pubkeys, until: unixNow() });
				}
				break;
			}
			case 4: {
				const pubkeys = Array.from(
					new Set<string>(
						event.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 'p')
							.map((tag) => tag[1])
							.filter((pubkey) => !profileMap.has(pubkey))
					)
				);
				if (pubkeys.length > 0) {
					rxReqB0.emit({ kinds: [0], authors: pubkeys, until: unixNow() });
				}
				break;
			}
			case 6:
			case 16: {
				fetchEventsByETags(event);
				break;
			}
			case 7: {
				fetchEventsByETags(event, true);
				fetchEventsByATags(event);
				break;
			}
			case 8: {
				const pubkeys = Array.from(
					new Set<string>(
						event.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 'p')
							.map((tag) => tag[1])
							.filter((pubkey) => !profileMap.has(pubkey))
					)
				);
				if (pubkeys.length > 0) {
					rxReqB0.emit({ kinds: [0], authors: pubkeys, until: unixNow() });
				}
				fetchEventsByATags(event);
				break;
			}
			case 40: {
				rxReqB41.emit({ kinds: [41], '#e': [event.id], until: unixNow() });
				break;
			}
			case 41: {
				const channelId = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1);
				if (channelId !== undefined && !channelMap.has(channelId)) {
					rxReqB40.emit({ kinds: [40], ids: [channelId], until: unixNow() });
				}
				break;
			}
			case 1:
			case 42:
			case 1111: {
				//多数のリアクションが付くと重くなる
				rxReqB7.emit({ kinds: [7], '#e': [event.id], limit: 10, until: unixNow() });
				const getIdOfMarkerd = (marker: string): string | undefined => {
					return event.tags
						.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === marker)
						?.at(1);
				};
				const rootId = getIdOfMarkerd('root');
				const repliedId = getIdOfMarkerd('reply');
				//自分が参照しているrootイベントまたはreply先イベントを取得する
				if (event.kind === 42) {
					if (rootId !== undefined && !channelMap.has(rootId)) {
						rxReqB40.emit({ kinds: [40], ids: [rootId], until: unixNow() });
					}
					if (repliedId !== undefined && !eventStore.hasEvent(repliedId)) {
						rxReqBId.emit({ kinds: [42], ids: [repliedId], until: unixNow() });
					}
				} else if (event.kind === 1) {
					const idToGet = repliedId ?? rootId;
					if (
						idToGet !== undefined &&
						!eventStore.hasEvent(idToGet) &&
						rootId !== undefined &&
						(countThread.get(rootId) ?? 0) < countThreadLimit
					) {
						countThread.set(rootId, (countThread.get(rootId) ?? 0) + 1);
						rxReqBId.emit({ ids: [idToGet], until: unixNow() });
					}
				} else if (event.kind === 1111) {
					const idReplyTo: string | undefined = event.tags
						.find((tag) => tag.length >= 2 && tag[0] === 'e')
						?.at(1);
					const idRoot: string | undefined = event.tags
						.find((tag) => tag.length >= 2 && tag[0] === 'E')
						?.at(1);
					let ap: nip19.AddressPointer | null = null;
					const aId = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'a')?.at(1);
					const AId = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'A')?.at(1);
					if (aId !== undefined) {
						ap = getAddressPointerFromAId(aId);
					}
					if (
						ap !== null &&
						!eventStore.hasReplaceable(ap.kind, ap.pubkey, ap.identifier) &&
						AId !== undefined &&
						(countThread.get(AId) ?? 0) < countThreadLimit
					) {
						countThread.set(AId, (countThread.get(AId) ?? 0) + 1);
						const filter: LazyFilter = {
							kinds: [ap.kind],
							authors: [ap.pubkey],
							until: unixNow()
						};
						if (ap.identifier.length > 0) {
							filter['#d'] = [ap.identifier];
						}
						rxReqBRp.emit(filter);
					} else if (
						idReplyTo !== undefined &&
						!eventStore.hasEvent(idReplyTo) &&
						idRoot !== undefined &&
						(countThread.get(idRoot) ?? 0) < countThreadLimit
					) {
						countThread.set(idRoot, (countThread.get(idRoot) ?? 0) + 1);
						rxReqBId.emit({ ids: [idRoot], until: unixNow() });
					}
				}
				//自分が参照しているrootイベントまたは自分自身のidを参照しているイベントを取得する
				//if (
				//	event.kind === 1 &&
				//	rootId !== undefined &&
				//	(countThread.get(rootId) ?? 0) < countThreadLimit
				//) {
				//	countThread.set(rootId, countThreadLimit); //この取得は一度だけでよい
				//	rxReqB1_42_1111.emit({ kinds: [event.kind], '#e': [rootId], limit: 10, until: unixNow() });
				//} else if (
				//	((event.kind === 1 && rootId === undefined) || event.kind === 42) &&
				//	(countThread.get(event.id) ?? 0) < countThreadLimit
				//) {
				//	countThread.set(event.id, countThreadLimit); //この取得は一度だけでよい
				//	rxReqB1_42_1111.emit({ kinds: [event.kind], '#e': [event.id], limit: 10, until: unixNow() });
				//}
				//↑海外リレーはスレッド文化過ぎて取得が終わらないので kind:1以外とする
				if (
					[42, 1111].includes(event.kind) &&
					(countThread.get(event.id) ?? 0) < countThreadLimit
				) {
					countThread.set(event.id, countThreadLimit); //この取得は一度だけでよい
					rxReqB1_42_1111.emit({
						kinds: [event.kind],
						'#e': [event.id],
						limit: 10,
						until: unixNow()
					});
				}
				getEventsQuoted(event);
				break;
			}
			case 1018: {
				fetchEventsByETags(event);
				break;
			}
			case 1068: {
				const pollExpiration: number = parseInt(
					event.tags
						.find((tag) => tag.length >= 2 && tag[0] === 'endsAt' && /^\d+$/.test(tag[1]))
						?.at(1) ?? '0'
				);
				rxReqB1_42_1111.emit({
					kinds: [1018],
					'#e': [event.id],
					until: pollExpiration
				});
				rxReqB7.emit({
					kinds: [7],
					'#e': [event.id],
					limit: 10,
					until: unixNow()
				});
				rxReqB1_42_1111.emit({
					kinds: [1111],
					'#E': [event.id],
					limit: 10,
					until: unixNow()
				});
				break;
			}
			case 9734: {
				fetchEventsByETags(event);
				fetchEventsByATags(event);
				const p = event.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'p')?.at(1);
				if (p !== undefined && !profileMap.has(p)) {
					rxReqB0.emit({ kinds: [0], authors: [p], until: unixNow() });
				}
				break;
			}
			case 9735: {
				const event9734: VerifiedEvent | null = getEvent9734(event);
				if (event9734 !== null) {
					eventStore.add(event9734);
					console.info('kind', event9734.kind);
				}
				break;
			}
			case 10000: {
				if (loginPubkey !== undefined && event.pubkey === loginPubkey) {
					const { pPub, ePub, wPub, tPub, pSec, eSec, wSec, tSec } = await splitNip51List(
						event,
						loginPubkey
					);
					mutedPubkeys = Array.from(new Set<string>([...pPub, ...pSec]));
					mutedChannelIds = Array.from(new Set<string>([...ePub, ...eSec]));
					mutedWords = Array.from(new Set<string>([...wPub, ...wSec].map((w) => w.toLowerCase())));
					mutedHashTags = Array.from(
						new Set<string>([...tPub, ...tSec].map((t) => t.toLowerCase()))
					);
					if (mutedPubkeys.length > 0) {
						rxReqB0.emit({ kinds: [0], authors: mutedPubkeys, until: unixNow() });
					}
					if (mutedChannelIds.length > 0) {
						rxReqB40.emit({ kinds: [40], ids: mutedChannelIds, until: unixNow() });
					}
				} else {
					const { pPub, ePub } = splitNip51ListPublic(event);
					if (pPub.length > 0) {
						rxReqB0.emit({ kinds: [0], authors: pPub, until: unixNow() });
					}
					if (ePub.length > 0) {
						rxReqB40.emit({ kinds: [40], ids: ePub, until: unixNow() });
					}
				}
				break;
			}
			case 10001: {
				fetchEventsByETags(event);
				break;
			}
			case 10003:
			case 30003: {
				if (
					event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'e').map((tag) => tag[1])
						.length <= 10
				) {
					fetchEventsByETags(event);
				}
				if (
					event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'a').map((tag) => tag[1])
						.length <= 10
				) {
					fetchEventsByATags(event);
				}
				break;
			}
			case 10005: {
				if (loginPubkey !== undefined && event.pubkey === loginPubkey) {
					const { ePub, eSec } = await splitNip51List(event, loginPubkey);
					myBookmarkedChannelIds = Array.from(new Set<string>([...ePub, ...eSec]));
				}
				const ids = event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'e')
					.map((tag) => tag[1])
					.filter((id) => !channelMap.has(id));
				if (ids.length > 0) {
					rxReqB40.emit({ kinds: [40], ids: ids, until: unixNow() });
				}
				break;
			}
			case 10030: {
				fetchEventsByATags(event);
				const ap: nip19.AddressPointer = {
					identifier: '',
					pubkey: event.pubkey,
					kind: event.kind
				};
				rxReqB7.emit({
					kinds: [7],
					'#a': [`${ap.kind}:${ap.pubkey}:${ap.identifier}`],
					limit: 10,
					until: unixNow()
				});
				break;
			}
			case 30008:
			case 30023:
			case 30030:
			case 31990: {
				const ap: nip19.AddressPointer = {
					identifier: event.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '',
					pubkey: event.pubkey,
					kind: event.kind
				};
				const filters: LazyFilter[] = [
					{
						kinds: [1111],
						'#A': [`${ap.kind}:${ap.pubkey}:${ap.identifier}`],
						limit: 10,
						until: unixNow()
					},
					{
						kinds: [7],
						'#a': [`${ap.kind}:${ap.pubkey}:${ap.identifier}`],
						limit: 10,
						until: unixNow()
					}
				];
				rxReqBRp.emit(filters);
				if (event.kind === 30023) {
					getEventsQuoted(event);
				}
				if (event.kind === 30008 && ap.identifier === 'profile_badges') {
					fetchEventsByETags(event);
					fetchEventsByATags(event);
				}
				break;
			}
			default:
				break;
		}
	});

//====================[イベントの受信]====================

export const fetchEventsMention = (until: number, completeCustom: () => void): void => {
	if (loginPubkey === undefined) {
		completeCustom();
		return;
	}
	let filters: LazyFilter[] = [];
	if (isEnabledSkipKind1) {
		filters = [
			{ kinds: [4, 42, 1111, 9735], '#p': [loginPubkey], limit: 10, until },
			{ kinds: [7, 16], '#p': [loginPubkey], '#k': ['42'], limit: 10, until }
		];
	} else {
		filters = [{ kinds: [1, 4, 6, 7, 16, 42, 1111, 9735], '#p': [loginPubkey], limit: 10, until }];
	}
	const rxReqBFirst = createRxBackwardReq();
	rxNostr.use(rxReqBFirst).pipe(tie, completeOnTimeout(secOnCompleteTimeout)).subscribe({
		next,
		complete: completeCustom
	});
	rxReqBFirst.emit(filters);
	rxReqBFirst.over();
};

const prepareFirstEvents = (completeOnNextFetch: () => void = complete) => {
	countThread = new Map<string, number>();
	if (loginPubkey === undefined) {
		return;
	}
	rxNostr.setDefaultRelays(relaysToUse);
	const rxReqB = createRxBackwardReq();
	const filterKinds = [3, 10000, 10001, 10002, 10005, 10030];
	if (!profileMap.has(loginPubkey)) {
		filterKinds.push(0);
	}
	const lFilter: LazyFilter = { kinds: filterKinds, authors: [loginPubkey], until: unixNow() };
	const observable$ = rxNostr.use(rxReqB, { relays: relaysToUseForProfile });
	const obs$ = filterKinds.map((kind) =>
		observable$.pipe(
			filterByKind(kind),
			latestEach(({ event }) => event.pubkey),
			debounceTime(secBufferTime)
		)
	);
	merge(...obs$)
		.pipe(tie, completeOnTimeout(secOnCompleteTimeout))
		.subscribe({
			next,
			complete: completeOnNextFetch
		});
	rxReqB.emit(lFilter);
	rxReqB.over();
	rxReqBRp.emit({ kinds: [30002, 30008], authors: [loginPubkey], until: unixNow() });
};

export const getEventsFirst = (
	urlParams: UrlParams,
	until: number = unixNow(),
	completeCustom: () => void = complete,
	isFirstFetch: boolean = true
): void => {
	const {
		currentProfilePointer,
		currentChannelPointer,
		currentEventPointer,
		currentAddressPointer,
		query,
		urlSearchParams,
		hashtag,
		category,
		isAntenna,
		isSettings
	} = urlParams;
	rxNostr.setDefaultRelays(relaysToUse);
	const filters: LazyFilter[] = [];
	let options: Partial<RxNostrUseOptions> | undefined;
	if (loginPubkey !== undefined && eventFollowList === undefined) {
		prepareFirstEvents(() => {
			if (eventFollowList === undefined) {
				return;
			}
			getEventsFirst(urlParams, until, completeCustom);
		});
		return;
	}
	const isTopPage =
		[
			currentEventPointer,
			currentProfilePointer,
			currentChannelPointer,
			currentAddressPointer,
			hashtag,
			category,
			query
		].every((q) => q === undefined) &&
		!isAntenna &&
		!isSettings;
	const pubkeysFollowing: string[] =
		eventFollowList?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ??
		[];
	const kindSet: Set<number> = new Set<number>();
	const authorSet: Set<string> = new Set<string>();
	const pSet: Set<string> = new Set<string>();
	const relaySet: Set<string> = new Set<string>();
	for (const [k, v] of urlSearchParams ?? []) {
		if (k === 'kind' && /^\d+$/.test(v)) {
			const kind = parseInt(v);
			if (0 <= kind && kind <= 65535) {
				kindSet.add(kind);
			}
		} else if (k === 'author') {
			authorSet.add(v);
		} else if (k === 'p') {
			try {
				const _npub = nip19.npubEncode(v);
			} catch (_error) {
				continue;
			}
			pSet.add(v);
		} else if (k === 'relay' && URL.canParse(v)) {
			relaySet.add(normalizeURL(v));
		}
	}
	if (currentProfilePointer !== undefined) {
		const fs: LazyFilter[] = [];
		if (kindSet.has(9735)) {
			fs.push({ kinds: [9735], '#P': [currentProfilePointer.pubkey] });
		}
		const kinds: number[] =
			kindSet.size === 0 ? [1, 6, 16, 42, 1111] : Array.from(kindSet).filter((k) => k !== 9735);
		if (kinds.length > 0) {
			fs.push({ kinds, authors: [currentProfilePointer.pubkey] });
		}
		for (const f of fs) {
			if (pSet.size > 0) {
				f['#p'] = Array.from(pSet);
			}
			filters.push(f);
		}
		for (const relay of currentProfilePointer.relays ?? []) {
			relaySet.add(normalizeURL(relay));
		}
	} else if (currentChannelPointer !== undefined) {
		filters.push({ kinds: [42], '#e': [currentChannelPointer.id] });
		filters.push({ kinds: [16], '#k': ['42'] });
		for (const relay of currentChannelPointer.relays ?? []) {
			relaySet.add(normalizeURL(relay));
		}
	} else if (currentEventPointer !== undefined) {
		filters.push({ ids: [currentEventPointer.id] });
		for (const relay of currentEventPointer.relays ?? []) {
			relaySet.add(normalizeURL(relay));
		}
	} else if (currentAddressPointer !== undefined) {
		if (currentAddressPointer.identifier.length > 0) {
			filters.push({
				kinds: [currentAddressPointer.kind],
				authors: [currentAddressPointer.pubkey],
				'#d': [currentAddressPointer.identifier]
			});
		} else {
			filters.push({
				kinds: [currentAddressPointer.kind],
				authors: [currentAddressPointer.pubkey]
			});
		}
		for (const relay of currentAddressPointer.relays ?? []) {
			relaySet.add(normalizeURL(relay));
		}
	} else if (hashtag !== undefined) {
		const kinds: number[] = kindSet.size === 0 ? [1, 42, 1111] : Array.from(kindSet);
		filters.push({ kinds, '#t': [hashtag] });
	} else if (category !== undefined) {
		filters.push({ kinds: [40, 41], '#t': [category] });
	} else if (query !== undefined) {
		options = { relays: searchRelays };
		const kinds: number[] = kindSet.size === 0 ? [40, 41] : Array.from(kindSet);
		const filter: LazyFilter = { kinds, limit: 10 };
		if (authorSet.size > 0) {
			filter.authors = Array.from(authorSet);
		}
		filter.search = query;
		filters.push(filter);
	} else if (isAntenna) {
		if (pubkeysFollowing.length > 0) {
			const fs: LazyFilter[] = [];
			if (kindSet.has(9735)) {
				fs.push({ kinds: [9735], '#P': pubkeysFollowing });
			}
			const kinds: number[] = (
				kindSet.size === 0 ? [1, 6, 16, 42, 1018, 1068, 1111] : Array.from(kindSet)
			).filter((k) => k !== 9735);
			if (kinds.length > 0) {
				fs.push({ kinds, authors: pubkeysFollowing });
			}
			for (const f of fs) {
				if (pSet.size > 0) {
					f['#p'] = Array.from(pSet);
				}
				filters.push(f);
			}
			//ブックマークしているチャンネルの投稿も取得したいが、limitで混ぜるのは難しいので考え中
		}
	} else if (isTopPage) {
		const kinds: number[] = kindSet.size === 0 ? [16, 42] : Array.from(kindSet);
		const f: LazyFilter = { kinds };
		if (pSet.size > 0) {
			f['#p'] = Array.from(pSet);
		}
		filters.push(f);
	}
	if (isFirstFetch && loginPubkey !== undefined) {
		if (isEnabledSkipKind1) {
			filters.push({ kinds: [4, 8, 42, 1111, 9735], '#p': [loginPubkey] });
			filters.push({ kinds: [7, 16], '#p': [loginPubkey], '#k': ['42'] });
		} else {
			filters.push({ kinds: [1, 4, 6, 7, 8, 16, 42, 1111, 9735], '#p': [loginPubkey] });
		}
	}
	if (isEnabledSkipKind1) {
		for (const f of filters) {
			if (f.kinds !== undefined) {
				f.kinds = f.kinds.filter((kind) => ![1, 6].includes(kind));
			}
		}
	}
	for (const f of filters) {
		f.until = until;
		f.limit = 10;
	}
	if (filters.length === 0) {
		subF?.unsubscribe();
		return;
	}
	if (relaySet.size > 0) {
		options = { relays: Array.from(relaySet) };
	}
	const rxReqBFirst = createRxBackwardReq();
	rxNostr
		.use(rxReqBFirst, { on: options })
		.pipe(tie, completeOnTimeout(secOnCompleteTimeout))
		.subscribe({
			next,
			complete: completeCustom
		});
	rxReqBFirst.emit(filters);
	rxReqBFirst.over();
	if (currentProfilePointer !== undefined && isFirstFetch) {
		const kinds = [10001, 10005, 30008];
		const rxReqBBookmark = createRxBackwardReq();
		rxNostr
			.use(rxReqBBookmark)
			.pipe(
				tie,
				latestEach(({ event }) => event.kind)
			)
			.subscribe({
				next,
				complete
			});
		rxReqBBookmark.emit({ kinds, authors: [currentProfilePointer.pubkey], until });
		rxReqBBookmark.over();
		for (const kind of kinds) {
			filters.find((f) => f.authors?.join(':') === currentProfilePointer.pubkey)?.kinds?.push(kind);
		}
	}
	//無限スクロール用Reqはここまでで終了
	if (!isFirstFetch) {
		return;
	}
	//ここから先はForwardReq用追加分(受信しっぱなし)
	if (loginPubkey !== undefined) {
		let kinds = [
			0, 1, 3, 4, 5, 6, 7, 40, 41, 42, 1018, 1068, 1111, 9735, 10000, 10001, 10002, 10005, 10030,
			30002, 30008
		];
		if (!pubkeysFollowing.includes(loginPubkey)) {
			kinds = kinds.concat(16).toSorted((a, b) => a - b);
		}
		filters.push({
			kinds,
			authors: [loginPubkey]
		});
	}
	if (currentProfilePointer !== undefined) {
		if (isEnabledSkipKind1) {
			filters.push({ kinds: [7], '#p': [currentProfilePointer.pubkey], '#k': ['42'] });
		} else {
			filters.push({ kinds: [7], '#p': [currentProfilePointer.pubkey] });
		}
	} else if (currentChannelPointer !== undefined) {
		filters.push({ kinds: [7], '#e': [currentChannelPointer.id] });
	} else if (currentEventPointer !== undefined) {
		filters.push({ kinds: [7], '#e': [currentEventPointer.id] });
	} else if (currentAddressPointer !== undefined) {
		filters.push({
			kinds: [7],
			'#a': [
				`${currentAddressPointer.kind}:${currentAddressPointer.pubkey}:${currentAddressPointer.identifier}`
			]
		});
	} else if (isAntenna && pubkeysFollowing.length > 0) {
		const f = filters.find((f) => f.authors?.join(':') === pubkeysFollowing.join(':'));
		if (f?.kinds !== undefined) {
			f.kinds = f.kinds.concat(0, 7, 40, 41).toSorted((a, b) => a - b);
		}
		if (isEnabledSkipKind1) {
			filters.push({ kinds: [7], '#p': pubkeysFollowing, '#k': ['42'] });
		} else {
			filters.push({ kinds: [7], '#p': pubkeysFollowing });
		}
	} else if (isTopPage) {
		filters.push({ kinds: [7], '#k': ['42'] });
	}
	//kind:16はkind:42が対象のものだけを受信する
	for (const f of [...filters]) {
		if (f.kinds?.includes(16) && !f['#k']?.includes('42')) {
			const fcopy: LazyFilter = { ...f };
			f.kinds = f.kinds.filter((kind) => kind !== 16);
			fcopy.kinds = [16];
			fcopy['#k'] = ['42'];
			filters.push(fcopy);
		}
	}
	for (const f of filters) {
		delete f.until;
		f.since = unixNow() + 1;
		delete f.limit;
	}
	if (pubkeysFollowing.length > 0) {
		//削除反映漏れに備えて kind:5 は少し前から取得する
		filters.push({
			kinds: [5],
			'#k': (isEnabledSkipKind1
				? [4, 7, 8, 16, 40, 41, 42, 1018, 1068, 1111]
				: [1, 4, 6, 7, 8, 16, 40, 41, 42, 1018, 1068, 1111]
			).map((n) => String(n)),
			authors: pubkeysFollowing,
			since: unixNow() - 60 * 60 * 12,
			limit: 10
		});
	}
	if (loginPubkey !== undefined) {
		//kind:30078 は署名時刻がブレるので全時刻取得すべき
		filters.push({
			kinds: [30078],
			'#d': ['nostter-read'],
			authors: [loginPubkey]
		});
	}
	subF?.unsubscribe();
	subF = rxNostr.use(rxReqF, { on: options }).pipe(tie).subscribe({
		next,
		complete
	});
	rxReqF.emit(filters);
};

//====================[イベントの送信]====================

export const muteUser = async (pubkey: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	const kind = 10000;
	let tags: string[][];
	let content: string;
	if (eventMuteList === undefined) {
		tags = [['p', pubkey]];
		content = '';
	} else if (mutedPubkeys.includes(pubkey)) {
		console.warn('already muted');
		return;
	} else {
		const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
		tags = tagList;
		content = await window.nostr.nip04.encrypt(
			loginPubkey,
			JSON.stringify([...contentList, ['p', pubkey]])
		);
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unmuteUser = async (pubkey: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	if (eventMuteList === undefined) {
		console.warn('kind:10000 event does not exist');
		return;
	} else if (!mutedPubkeys.includes(pubkey)) {
		console.warn('not muted yet');
		return;
	}
	const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
	const tags: string[][] = tagList.filter(
		(tag) => !(tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey)
	);
	const content: string = !contentList.some(
		(tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey
	)
		? eventMuteList.content
		: await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify(
					contentList.filter((tag) => !(tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey))
				)
			);
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: eventMuteList.kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const muteChannel = async (channelId: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	const kind = 10000;
	let tags: string[][];
	let content: string;
	if (eventMuteList === undefined) {
		tags = [['e', channelId]];
		content = '';
	} else if (mutedChannelIds.includes(channelId)) {
		console.warn('already muted');
		return;
	} else {
		const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
		tags = tagList;
		content = await window.nostr.nip04.encrypt(
			loginPubkey,
			JSON.stringify([...contentList, ['e', channelId]])
		);
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unmuteChannel = async (channelId: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	if (eventMuteList === undefined) {
		console.warn('kind:10000 event does not exist');
		return;
	} else if (!mutedChannelIds.includes(channelId)) {
		console.warn('not muted yet');
		return;
	}
	const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
	const tags: string[][] = tagList.filter(
		(tag) => !(tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId)
	);
	const content: string = !contentList.some(
		(tag) => tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId
	)
		? eventMuteList.content
		: await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify(
					contentList.filter((tag) => !(tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId))
				)
			);
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: eventMuteList.kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unmuteWord = async (word: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	word = word.toLowerCase();
	if (eventMuteList === undefined) {
		console.warn('kind:10000 event does not exist');
		return;
	} else if (!mutedWords.includes(word)) {
		console.warn('not muted yet');
		return;
	}
	const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
	const tags: string[][] = tagList.filter(
		(tag) => !(tag.length >= 2 && tag[0] === 'word' && tag[1].toLowerCase() === word)
	);
	const content: string = !contentList.some(
		(tag) => tag.length >= 2 && tag[0] === 'word' && tag[1].toLowerCase() === word
	)
		? eventMuteList.content
		: await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify(
					contentList.filter(
						(tag) => !(tag.length >= 2 && tag[0] === 'word' && tag[1].toLowerCase() === word)
					)
				)
			);
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: eventMuteList.kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const muteHashTag = async (hashTag: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	hashTag = hashTag.toLowerCase();
	const kind = 10000;
	let tags: string[][];
	let content: string;
	if (eventMuteList === undefined) {
		tags = [['t', hashTag]];
		content = '';
	} else if (mutedHashTags.includes(hashTag)) {
		console.warn('already muted');
		return;
	} else {
		const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
		tags = tagList;
		content = await window.nostr.nip04.encrypt(
			loginPubkey,
			JSON.stringify([...contentList, ['t', hashTag]])
		);
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unmuteHashTag = async (hashTag: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	hashTag = hashTag.toLowerCase();
	if (eventMuteList === undefined) {
		console.warn('kind:10000 event does not exist');
		return;
	} else if (!mutedHashTags.includes(hashTag)) {
		console.warn('not muted yet');
		return;
	}
	const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
	const tags: string[][] = tagList.filter(
		(tag) => !(tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashTag)
	);
	const content: string = !contentList.some(
		(tag) => tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashTag
	)
		? eventMuteList.content
		: await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify(
					contentList.filter(
						(tag) => !(tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashTag)
					)
				)
			);
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: eventMuteList.kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const followUser = async (pubkey: string): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const kind = 3;
	let tags: string[][];
	let content: string;
	const followingPubkeys: string[] =
		eventFollowList?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ??
		[];
	if (followingPubkeys.includes(pubkey)) {
		console.warn('already followed');
		return;
	} else {
		tags = [...(eventFollowList?.tags ?? []), ['p', pubkey]];
		content = eventFollowList?.content ?? '';
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unfollowUser = async (pubkey: string): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	if (eventFollowList === undefined) {
		console.warn('kind:3 event does not exist');
		return;
	}
	const kind = 3;
	let tags: string[][];
	let content: string;
	const followingPubkeys: string[] =
		eventFollowList.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ??
		[];
	if (!followingPubkeys.includes(pubkey)) {
		console.warn('not followed yet');
		return;
	} else {
		tags =
			eventFollowList.tags.filter(
				(tag) => !(tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey)
			) ?? [];
		content = eventFollowList.content ?? '';
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const bookmarkChannel = async (channelId: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	const kind = 10005;
	let tags: string[][];
	let content: string;
	if (eventMyPublicChatsList === undefined) {
		tags = [['e', channelId]];
		content = '';
	} else if (myBookmarkedChannelIds.includes(channelId)) {
		console.warn('already bookmarked');
		return;
	} else {
		const getList = (tags: string[][], tagName: string): string[] =>
			tags.filter((tag) => tag.length >= 2 && tag[0] === tagName).map((tag) => tag[1]);
		const ePub = getList(eventMyPublicChatsList.tags, 'e');
		tags = [...ePub.map((id) => ['e', id]), ['e', channelId]];
		content = eventMyPublicChatsList.content;
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unbookmarkChannel = async (channelId: string, loginPubkey: string): Promise<void> => {
	if (window.nostr?.nip04 === undefined) {
		return;
	}
	if (eventMyPublicChatsList === undefined) {
		console.warn('kind:10005 event does not exist');
		return;
	} else if (!myBookmarkedChannelIds.includes(channelId)) {
		console.warn('not bookmarked yet');
		return;
	}
	const { tagList, contentList } = await splitNip51List(eventMyPublicChatsList, loginPubkey);
	const tags: string[][] = tagList.filter(
		(tag) => !(tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId)
	);
	const content: string = !contentList.some(
		(tag) => tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId
	)
		? eventMyPublicChatsList.content
		: await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify(
					contentList.filter((tag) => !(tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId))
				)
			);
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: eventMyPublicChatsList.kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const bookmarkEmojiSets = async (
	aTagStr: string,
	recommendedRelay: string | undefined
): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const kind = 10030;
	let tags: string[][];
	let content: string;
	const aTagStrs = eventEmojiSetList?.tags
		.filter((tag) => tag.length >= 2 && tag[0] === 'a')
		.map((tag) => tag[1]);
	const aTag = ['a', aTagStr];
	if (recommendedRelay !== undefined) {
		aTag.push(recommendedRelay);
	}
	if (eventEmojiSetList === undefined || aTagStrs === undefined) {
		tags = [aTag];
		content = '';
	} else if (aTagStrs.includes(aTagStr)) {
		console.warn('already bookmarked');
		return;
	} else {
		tags = [...eventEmojiSetList.tags, aTag];
		content = eventEmojiSetList.content;
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unbookmarkEmojiSets = async (aTagStr: string): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const aTags = eventEmojiSetList?.tags
		.filter((tag) => tag.length >= 2 && tag[0] === 'a')
		.map((tag) => tag[1]);
	if (eventEmojiSetList === undefined || aTags === undefined) {
		console.warn('kind:10030 event does not exist');
		return;
	} else if (!aTags.includes(aTagStr)) {
		console.warn('not bookmarked yet');
		return;
	}
	const tags: string[][] = eventEmojiSetList.tags.filter(
		(tag) => !(tag.length >= 2 && tag[0] === 'a' && tag[1] === aTagStr)
	);
	const content: string = eventEmojiSetList.content;
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: eventEmojiSetList.kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const bookmarkBadge = async (
	profileBadgesEvent: NostrEvent | undefined,
	aTagStr: string,
	recommendedRelayATag: string | undefined,
	eTagStr: string,
	recommendedRelayETag: string | undefined
): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const kind = 30008;
	let tags: string[][];
	let content: string;
	const aTagStrs = profileBadgesEvent?.tags
		.filter((tag) => tag.length >= 2 && tag[0] === 'a')
		.map((tag) => tag[1]);
	const aTag = ['a', aTagStr];
	if (recommendedRelayATag !== undefined) {
		aTag.push(recommendedRelayATag);
	}
	const eTag = ['e', eTagStr];
	if (recommendedRelayETag !== undefined) {
		eTag.push(recommendedRelayETag);
	}
	if (profileBadgesEvent === undefined || aTagStrs === undefined) {
		const dTag = ['d', 'profile_badges'];
		tags = [dTag, aTag, eTag];
		content = '';
	} else if (aTagStrs.includes(aTagStr)) {
		console.warn('already bookmarked');
		return;
	} else {
		tags = [...profileBadgesEvent.tags, aTag, eTag];
		content = profileBadgesEvent.content;
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const unbookmarkBadge = async (
	profileBadgesEvent: NostrEvent | undefined,
	aTagStr: string,
	eTagStr: string
): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const aTags = profileBadgesEvent?.tags
		.filter((tag) => tag.length >= 2 && tag[0] === 'a')
		.map((tag) => tag[1]);
	if (profileBadgesEvent === undefined || aTags === undefined) {
		console.warn('kind:30008 profile_badges event does not exist');
		return;
	} else if (!aTags.includes(aTagStr)) {
		console.warn('not bookmarked yet');
		return;
	}
	const tags: string[][] = profileBadgesEvent.tags.filter(
		(tag) =>
			!(
				(tag.length >= 2 && tag[0] === 'a' && tag[1] === aTagStr) ||
				(tag.length >= 2 && tag[0] === 'e' && tag[1] === eTagStr)
			)
	);
	const content: string = profileBadgesEvent.content;
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: profileBadgesEvent.kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const sendRepost = async (targetEvent: NostrEvent): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	let kind: number = 6;
	const content: string = ''; //魚拓リポストはしない
	const tags: string[][] = [];
	const recommendedRelay: string = getSeenOn(targetEvent.id).at(0) ?? '';
	if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
		const d = targetEvent.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
		tags.push(['a', `${targetEvent.kind}:${targetEvent.pubkey}:${d}`, recommendedRelay]);
	}
	tags.push(['e', targetEvent.id, recommendedRelay], ['p', targetEvent.pubkey]);
	if (targetEvent.kind !== 1) {
		kind = 16;
		tags.push(['k', String(targetEvent.kind)]);
	}
	if (isEnabledUseClientTag) {
		tags.push(clientTag);
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const sendReaction = async (
	targetEvent: NostrEvent,
	content: string = defaultReactionToAdd,
	emojiurl?: string
): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const tags: string[][] = [];
	const recommendedRelay: string = getSeenOn(targetEvent.id).at(0) ?? '';
	if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
		const d = targetEvent.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
		tags.push(['a', `${targetEvent.kind}:${targetEvent.pubkey}:${d}`, recommendedRelay]);
	}
	tags.push(
		['e', targetEvent.id, recommendedRelay],
		['p', targetEvent.pubkey],
		['k', String(targetEvent.kind)]
	);
	if (emojiurl !== undefined && URL.canParse(emojiurl)) {
		tags.push(['emoji', content.replaceAll(':', ''), emojiurl]);
	}
	if (isEnabledUseClientTag) {
		tags.push(clientTag);
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: 7,
		tags,
		content,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	if (!isValidEmoji(eventToSend)) {
		console.warn('emoji is invalid');
		return;
	}
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const sendDeletion = async (targetEvent: NostrEvent): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const tags = [
		['e', targetEvent.id],
		['k', String(targetEvent.kind)]
	];
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: 5,
		tags,
		content: '',
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const sendReadTime = async (time: number): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	const tags = [['d', 'nostter-read']];
	const eventTemplate: EventTemplate = $state.snapshot({
		kind: 30078,
		tags,
		content: '',
		created_at: time
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const sendChannelEdit = async (channel: ChannelContent) => {
	if (window.nostr === undefined) {
		return;
	}
	const contentBase: string = channel.eventkind41?.content ?? channel.eventkind40.content;
	const obj = JSON.parse(contentBase);
	obj.name = channel.name;
	obj.about = channel.about ?? '';
	obj.picture = channel.picture ?? '';
	obj.relays = relaysToWrite;
	const content = JSON.stringify(obj);
	const recommendedRelay: string = getSeenOn(channel.id).at(0) ?? '';
	const eTag = ['e', channel.id, recommendedRelay, 'root', channel.pubkey];
	const tags: string[][] = [eTag];
	for (const tTag of new Set(channel.categories)) {
		tags.push(['t', tTag]);
	}
	if (isEnabledUseClientTag) {
		tags.push(clientTag);
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		content,
		kind: 41,
		tags,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	sendEvent(eventToSend, options);
};

export const sendPollResponse = async (
	targetEventToRespond: NostrEvent,
	responses: string[],
	relaysToWriteCustom?: string[]
) => {
	if (window.nostr === undefined) {
		return;
	}
	const content = '';
	const kind = 1018;
	const tags: string[][] = [
		['e', targetEventToRespond.id],
		...responses.map((response) => ['response', response])
	];
	if (isEnabledUseClientTag) {
		tags.push(clientTag);
	}
	const eventTemplate: EventTemplate = $state.snapshot({
		content,
		kind,
		tags,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = {
		on: { relays: relaysToWriteCustom ?? relaysToWrite }
	};
	sendEvent(eventToSend, options);
};

export const makeEvent = (
	loginPubkey: string,
	content: string,
	channelNameToCreate: string,
	pubkeysExcluded: string[],
	targetEventToReply?: NostrEvent,
	emojiMap?: Map<string, string>,
	imetaMap?: Map<string, FileUploadResponse>,
	contentWarningReason?: string | null | undefined,
	pollItems?: string[],
	pollEndsAt?: number,
	pollType?: 'singlechoice' | 'multiplechoice',
	kindForEdit?: number
): {
	eventToSend: UnsignedEvent;
	eventChannelToSend: UnsignedEvent | undefined;
	options: Partial<RxNostrSendOptions>;
} => {
	const relaysToAdd: Set<string> = new Set<string>();
	let eventChannelToSend: UnsignedEvent | undefined;
	if (kindForEdit !== undefined || (pollItems !== undefined && pollItems.length > 0)) {
		//do nothing
	} else if (targetEventToReply === undefined && channelNameToCreate.length > 0) {
		//チャンネル作成
		const eventTemplateChannel: UnsignedEvent = $state.snapshot({
			content: JSON.stringify({
				name: channelNameToCreate,
				about: '',
				picture: '',
				relays: relaysToWrite
			}),
			kind: 40,
			tags: isEnabledUseClientTag ? [clientTag] : [],
			created_at: unixNow(),
			pubkey: loginPubkey
		});
		eventChannelToSend = eventTemplateChannel;
		targetEventToReply = {
			...eventTemplateChannel,
			id: getEventHash(eventTemplateChannel),
			sig: ''
		};
	} else if (targetEventToReply !== undefined && [40, 42].includes(targetEventToReply.kind)) {
		const channelId: string | undefined =
			targetEventToReply.kind === 40
				? targetEventToReply.id
				: targetEventToReply.tags
						.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
						?.at(1);
		const channel: ChannelContent | undefined = channelMap.get(channelId ?? '');
		for (const relay of channel?.relays ?? []) {
			relaysToAdd.add(relay);
		}
	}
	//投稿作成
	const recommendedRelay: string =
		targetEventToReply === undefined ? '' : (getSeenOn(targetEventToReply.id).at(0) ?? '');
	let tags: string[][] = [];
	const mentionPubkeys: Set<string> = new Set();
	let pubkeyToReply: string | undefined;
	let kind: number;
	if (kindForEdit !== undefined) {
		kind = kindForEdit;
	} else if (pollItems !== undefined && pollItems.length > 0) {
		kind = 1068;
		const getRandomString = (n: number): string => {
			const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
			return [...Array(n)]
				.map((_) => chars.charAt(Math.floor(Math.random() * chars.length)))
				.join('');
		};
		const tagsToAdd: string[][] = [
			...pollItems.map((item) => ['option', getRandomString(9), item]),
			...relaysToWrite.map((relay) => ['relay', relay]),
			['polltype', pollType ?? 'singlechoice'],
			['endsAt', String(pollEndsAt ?? 0)]
		];
		for (const tag of tagsToAdd) {
			tags.push(tag);
		}
	} else if (targetEventToReply === undefined) {
		kind = 1;
	} else if (targetEventToReply.kind === 40) {
		kind = 42;
	} else {
		pubkeyToReply = targetEventToReply.pubkey;
		if ([1, 42].includes(targetEventToReply.kind)) {
			kind = targetEventToReply.kind;
		} else {
			kind = 1111;
		}
	}
	if (targetEventToReply === undefined) {
		//do nothing
	} else if ([1, 40, 42].includes(targetEventToReply.kind)) {
		const rootTag = targetEventToReply.tags.find(
			(tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root'
		);
		if (rootTag !== undefined) {
			tags.push(rootTag);
			tags.push(['e', targetEventToReply.id, recommendedRelay, 'reply', targetEventToReply.pubkey]);
			mentionPubkeys.add(targetEventToReply.pubkey);
		} else {
			tags.push(['e', targetEventToReply.id, recommendedRelay, 'root', targetEventToReply.pubkey]);
		}
		for (const p of targetEventToReply.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'p')
			.map((tag) => tag[1])) {
			mentionPubkeys.add(p);
		}
	} else {
		if (targetEventToReply.kind === 1111) {
			const tagsCopied = targetEventToReply.tags.filter(
				(tag) => tag.length >= 2 && ['A', 'E', 'I', 'K', 'P'].includes(tag[0])
			);
			for (const tag of tagsCopied) {
				tags.push(tag);
			}
			tags.push(['e', targetEventToReply.id, recommendedRelay, targetEventToReply.pubkey]);
			tags.push(['k', String(targetEventToReply.kind)]);
		} else if (
			isReplaceableKind(targetEventToReply.kind) ||
			isAddressableKind(targetEventToReply.kind)
		) {
			const d =
				targetEventToReply.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
			const a = `${targetEventToReply.kind}:${targetEventToReply.pubkey}:${d}`;
			tags.push(['A', a, recommendedRelay]);
			tags.push(['K', String(targetEventToReply.kind)]);
			tags.push(['P', targetEventToReply.pubkey]);
			tags.push(['a', a, recommendedRelay]);
			tags.push(['k', String(targetEventToReply.kind)]);
		} else {
			tags.push(['E', targetEventToReply.id, recommendedRelay, targetEventToReply.pubkey]);
			tags.push(['K', String(targetEventToReply.kind)]);
			tags.push(['P', targetEventToReply.pubkey]);
			tags.push(['e', targetEventToReply.id, recommendedRelay, targetEventToReply.pubkey]);
			tags.push(['k', String(targetEventToReply.kind)]);
		}
	}
	const quoteIds: Set<string> = new Set<string>();
	const apsMap: Map<string, nip19.AddressPointer> = new Map<string, nip19.AddressPointer>();
	const matchesIteratorId = content.matchAll(
		/(^|\W|\b)(nostr:(note1\w{58}|nevent1\w+|naddr1\w+))($|\W|\b)/g
	);
	for (const match of matchesIteratorId) {
		let d;
		try {
			d = nip19.decode(match[3]);
		} catch (error) {
			console.warn(error);
			console.info(content);
			continue;
		}
		if (d.type === 'note') {
			quoteIds.add(d.data);
		} else if (d.type === 'nevent') {
			quoteIds.add(d.data.id);
			if (d.data.author !== undefined) {
				mentionPubkeys.add(d.data.author);
			}
		} else if (d.type === 'naddr') {
			apsMap.set(`${d.data.kind}:${d.data.pubkey}:${d.data.identifier}`, d.data);
			mentionPubkeys.add(d.data.pubkey);
		}
	}
	const matchesIteratorPubkey = content.matchAll(
		/(^|\W|\b)(nostr:(npub1\w{58}|nprofile1\w+))($|\W|\b)/g
	);
	for (const match of matchesIteratorPubkey) {
		let d;
		try {
			d = nip19.decode(match[3]);
		} catch (error) {
			console.warn(error);
			console.info(content);
			continue;
		}
		if (d.type === 'npub') {
			mentionPubkeys.add(d.data);
		} else if (d.type === 'nprofile') {
			mentionPubkeys.add(d.data.pubkey);
		}
	}
	if (pubkeyToReply !== undefined) {
		mentionPubkeys.add(pubkeyToReply);
	}
	const matchesIteratorHashTag = content.matchAll(/(^|\s)#([^\s#]+)/g);
	const hashtags: Set<string> = new Set();
	for (const match of matchesIteratorHashTag) {
		hashtags.add(match[2].toLowerCase());
	}
	const matchesIteratorLink = content.matchAll(/https?:\/\/[\w!?/=+\-_~:;.,*&@#$%()[\]]+/g);
	const links: Set<string> = new Set();
	for (const match of matchesIteratorLink) {
		links.add(urlLinkString(match[0])[0]);
	}
	const imetaTags: string[][] = [];
	if (imetaMap !== undefined) {
		for (const [url, fr] of imetaMap) {
			if (!links.has(url) || fr.nip94_event === undefined) {
				continue;
			}
			imetaTags.push([
				'imeta',
				...fr.nip94_event.tags
					.filter((tag) => tag.length >= 2 && tag[0].length > 0 && tag[1].length > 0)
					.map((tag) => `${tag[0]} ${tag[1]}`)
			]);
		}
	}
	const emojiShortcodes: Set<string> = new Set();
	if (emojiMap !== undefined) {
		const matchesIteratorEmojiTag = content.matchAll(
			new RegExp(`:(${Array.from(emojiMap.keys()).join('|')}):`, 'g')
		);
		for (const match of matchesIteratorEmojiTag) {
			if (emojiMap.has(match[1])) emojiShortcodes.add(match[1]);
		}
	}
	for (const id of quoteIds) {
		const qTag: string[] = ['q', id];
		const recommendedRelayForQuote: string | undefined = getSeenOn(id).at(0);
		if (recommendedRelayForQuote !== undefined) {
			qTag.push(recommendedRelayForQuote);
			const pubkeyForQuote: string | undefined = getEventById(id)?.pubkey;
			if (pubkeyForQuote !== undefined) {
				qTag.push(pubkeyForQuote);
			}
		}
		tags.push(qTag);
		const ev = getEventById(id);
		if (ev !== undefined) {
			mentionPubkeys.add(ev.pubkey);
		}
	}
	for (const [a, ap] of apsMap) {
		const aTag: string[] = ['a', a];
		const ev: NostrEvent | undefined = eventStore.getReplaceable(ap.kind, ap.pubkey, ap.identifier);
		const recommendedRelayForQuote: string | undefined =
			getSeenOn(ev?.id ?? '').at(0) ?? ap.relays?.at(0);
		if (recommendedRelayForQuote !== undefined) {
			aTag.push(recommendedRelayForQuote);
		}
		tags.push(aTag);
		mentionPubkeys.add(ap.pubkey);
	}
	for (const p of mentionPubkeys) {
		if (!pubkeysExcluded.includes(p)) {
			tags.push(['p', p]);
		}
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
	for (const e of emojiShortcodes) {
		tags.push(['emoji', e, emojiMap!.get(e)!]);
	}
	if (contentWarningReason !== undefined) {
		tags.push(
			contentWarningReason === null
				? ['content-warning']
				: ['content-warning', contentWarningReason]
		);
	}
	if (isEnabledUseClientTag) {
		tags.push(clientTag);
	}
	if (kindForEdit === 10001) {
		content = '';
		tags = tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'q')
			.map((tag) => {
				const r = ['e', tag[1]];
				if (tag[2] !== undefined) {
					r.push(tag[2]);
					if (tag[3] !== undefined) {
						r.push('');
						r.push(tag[3]);
					}
				}
				return r;
			});
	}
	const eventToSend: UnsignedEvent = $state.snapshot({
		content,
		kind,
		tags,
		created_at: unixNow(),
		pubkey: loginPubkey
	});
	for (const relay of relaysToWrite) {
		relaysToAdd.add(relay);
	}
	const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaysToAdd) } };
	return { eventToSend, eventChannelToSend, options };
};

export const sendNote = async (
	loginPubkey: string,
	content: string,
	channelNameToCreate: string,
	pubkeysExcluded: string[],
	targetEventToReply?: NostrEvent,
	emojiMap?: Map<string, string>,
	imetaMap?: Map<string, FileUploadResponse>,
	contentWarningReason?: string | null | undefined,
	pollItems?: string[],
	pollEndsAt?: number,
	pollType?: 'singlechoice' | 'multiplechoice',
	kindForEdit?: number
): Promise<NostrEvent | null> => {
	if (window.nostr === undefined) {
		return null;
	}
	const { eventToSend, eventChannelToSend, options } = makeEvent(
		loginPubkey,
		content,
		channelNameToCreate,
		pubkeysExcluded,
		targetEventToReply,
		emojiMap,
		imetaMap,
		contentWarningReason,
		pollItems,
		pollEndsAt,
		pollType,
		kindForEdit
	);
	if (eventChannelToSend !== undefined) {
		const signedEventChannelToSend = await window.nostr.signEvent(eventChannelToSend);
		sendEvent(signedEventChannelToSend, options);
	}
	const signedEventToSend = await window.nostr.signEvent(eventToSend);
	sendEvent(signedEventToSend, options);
	return signedEventToSend;
};

export const sendEvent = (eventToSend: NostrEvent, options?: Partial<RxNostrSendOptions>): void => {
	rxNostr.send(eventToSend, options);
};
