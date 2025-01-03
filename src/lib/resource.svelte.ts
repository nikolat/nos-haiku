import { bufferTime, Subscription, merge, debounceTime, Subject } from 'rxjs';
import {
	batch,
	completeOnTimeout,
	createRxBackwardReq,
	createRxForwardReq,
	createRxNostr,
	filterByKind,
	latestEach,
	uniq,
	type EventPacket,
	type LazyFilter,
	type MergeFilter,
	type RxNostrSendOptions,
	type RxNostrUseOptions
} from 'rx-nostr';
import { verifier } from 'rx-nostr-crypto';
import { EventStore } from 'applesauce-core';
import { unixNow, getProfileContent, type ProfileContent } from 'applesauce-core/helpers';
import { sortEvents, type EventTemplate, type NostrEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import type { RelayRecord } from 'nostr-tools/relay';
import type { WindowNostr } from 'nostr-tools/nip07';
import {
	clientTag,
	defaultReactionToAdd,
	defaultRelays,
	profileRelays,
	searchRelays,
	subRelaysForChannel,
	uploaderURLs
} from '$lib/config';
import { preferences } from '$lib/store';
import {
	getEvent9734,
	getIdsForFilter,
	getPubkeysForFilter,
	getRelaysToUseByRelaysSelected,
	isValidEmoji,
	splitNip51List,
	type ChannelContent,
	type ProfileContentEvent,
	type UrlParams
} from '$lib/utils';

let loginPubkey: string | undefined = $state();
let isEnabledDarkMode: boolean = $state(true);
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
const relaysToWrite: string[] = $derived(
	Object.entries(relaysToUse)
		.filter((v) => v[1].write)
		.map((v) => v[0])
);

preferences.subscribe(
	(value: {
		loginPubkey: string | undefined;
		isEnabledDarkMode: boolean;
		isEnabledSkipKind1: boolean;
		isEnabledUseClientTag: boolean;
		relaysSelected: string;
		uploaderSelected: string;
		relaysToUse: RelayRecord;
	}) => {
		if (loginPubkey !== value.loginPubkey) {
			loginPubkey = value.loginPubkey;
		}
		if (isEnabledDarkMode !== value.isEnabledDarkMode) {
			isEnabledDarkMode = value.isEnabledDarkMode;
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
		isEnabledDarkMode,
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
let subF: Subscription;

let eventsMention: { baseEvent: NostrEvent; targetEvent: NostrEvent | undefined }[] = $state([]);
let eventsProfile: NostrEvent[] = $state([]);
let eventsChannel: NostrEvent[] = $state([]);
let eventsChannelEdit: NostrEvent[] = $state([]);
let eventsTimeline: NostrEvent[] = $state([]);
let eventsChannelBookmark: NostrEvent[] = $state([]);
let eventsReaction: NostrEvent[] = $state([]);
let eventFollowList: NostrEvent | undefined = $state();
let eventRead: NostrEvent | undefined = $state();
let eventMuteList: NostrEvent | undefined;
let eventRelayList: NostrEvent | undefined;
let eventMyPublicChatsList: NostrEvent | undefined;
let eventEmojiSetList: NostrEvent | undefined;
let eventEmojiSet: NostrEvent[] = $state([]);
let eventsDeletion: NostrEvent[] = [];
let eventsAll: NostrEvent[] = $state([]);
let mutedPubkeys: string[] = $state([]);
let mutedChannelIds: string[] = $state([]);
let mutedWords: string[] = $state([]);
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
			profileMap.set(ev.pubkey, { ...getProfileContent(ev), event: ev });
		}
	}
	return profileMap;
});

const channelMap = $derived.by(() => {
	const channelMap = new Map<string, ChannelContent>();
	for (const ev of eventsChannel) {
		let channel: ChannelContent;
		try {
			channel = JSON.parse(ev.content);
		} catch (error) {
			console.warn(error);
			continue;
		}
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
				channel.eventkind40 = c.eventkind40;
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

export const getProfileName = (prof: ProfileContent | undefined) => {
	return prof?.display_name || (prof?.name !== undefined ? `id:${prof?.name}` : 'anonymouse');
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

export const getIsEnabledDarkMode = (): boolean => {
	return isEnabledDarkMode;
};

export const setIsEnabledDarkMode = (value: boolean): void => {
	isEnabledDarkMode = value;
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
	relaysToUse = await getRelaysToUseByRelaysSelected(relaysSelected, eventRelayList);
	savelocalStorage();
};

export const clearCache = () => {
	for (const ev of eventStore.getAll([{ kinds: [1, 3, 6, 7, 16, 42, 10000, 30078] }])) {
		eventStore.database.deleteEvent(ev);
	}
	if (loginPubkey !== undefined) {
		const ev = eventStore.getReplaceable(10005, loginPubkey);
		if (ev !== undefined) {
			eventStore.database.deleteEvent(ev);
		}
	}
	eventsTimeline = [];
	eventsMention = [];
	eventFollowList = undefined;
	eventMuteList = undefined;
	eventMyPublicChatsList = undefined;
	eventRead = undefined;
	mutedPubkeys = [];
	mutedChannelIds = [];
	mutedWords = [];
	myBookmarkedChannelIds = [];
	subF?.unsubscribe();
	flushes$.next();
};

export const getEventsMention = (): {
	baseEvent: NostrEvent;
	targetEvent: NostrEvent | undefined;
}[] => {
	return eventsMention;
};

export const getEventsTimelineTop = (): NostrEvent[] => {
	return eventsTimeline;
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

export const getProfileEventMap = (): Map<string, NostrEvent> => {
	return new Map<string, NostrEvent>(eventsProfile.map((ev) => [ev.pubkey, ev]));
};

export const getEventsReaction = (): NostrEvent[] => {
	return eventsReaction;
};

export const getEventEmojiSet = (): NostrEvent[] => {
	return eventEmojiSet;
};

export const getEventById = (id: string): NostrEvent | undefined => {
	return eventsAll.find((ev) => ev.id === id);
};

export const getEventByIdAddressPointer = (data: nip19.AddressPointer): NostrEvent | undefined => {
	return eventsAll.find(
		(ev) =>
			ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) === data.identifier &&
			ev.pubkey === data.pubkey &&
			ev.kind === data.kind
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

export const getFollowList = (): NostrEvent | undefined => {
	return eventFollowList;
};

export const getReadTimeOfNotification = (): number => {
	return eventRead?.created_at ?? 0;
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
		case 16:
		case 42: {
			if (
				kind === 16 &&
				event?.tags.find((tag) => tag.length >= 2 && tag[0] === 'k')?.at(1) !== '42'
			) {
				break;
			}
			eventsTimeline = sortEvents(
				Array.from(
					eventStore.getAll([
						{ kinds: isEnabledSkipKind1 ? [42] : [1, 6, 42] },
						{ kinds: [16], '#k': ['42'] }
					])
				).filter(
					(ev) =>
						ev.kind !== 42 ||
						(ev.kind === 42 &&
							ev.tags.filter((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
								.length === 1)
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
			}
			break;
		}
		case 30030: {
			if (loginPubkey !== undefined && eventEmojiSetList !== undefined) {
				const events30030 = sortEvents(Array.from(eventStore.getAll([{ kinds: [30030] }])));
				const aTags = eventEmojiSetList.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'a')
					.map((tag) => tag[1]);
				eventEmojiSet = events30030.filter((ev) =>
					aTags.includes(
						`${ev.kind}:${ev.pubkey}:${ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1)}`
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
		const eventsMentionKey = sortEvents(
			Array.from(
				eventStore.getAll(
					isEnabledSkipKind1
						? [
								{ '#p': [loginPubkey], kinds: [42, 9734] },
								{ '#p': [loginPubkey], kinds: [7, 16], '#k': ['42'] }
							]
						: [
								{ '#p': [loginPubkey], kinds: [1, 6, 7, 42, 9734] },
								{ '#p': [loginPubkey], kinds: [16], '#k': ['42'] }
							]
				)
			)
		).filter(
			(ev) =>
				!(
					ev.kind === 7 &&
					ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'p')?.at(1) !== loginPubkey
				)
		);
		eventsMention = eventsMentionKey.map(
			(ev: NostrEvent): { baseEvent: NostrEvent; targetEvent: NostrEvent | undefined } => {
				const targetEvent = eventStore.getEvent(
					(
						ev.tags.find(
							(tag) =>
								tag.length >= 4 && tag[0] === 'e' && tag[3] === 'reply' && [1, 42].includes(ev.kind)
						) ??
						ev.tags.find(
							(tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root' && ev.kind === 1
						) ??
						ev.tags.find(
							(tag) => tag.length >= 2 && tag[0] === 'e' && [6, 16, 9734].includes(ev.kind)
						) ??
						ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e' && ev.kind === 7)
					)?.at(1) ?? ''
				);
				return { baseEvent: ev, targetEvent };
			}
		);
	}
	eventsAll = Array.from(eventStore.getAll([{ until: unixNow() }]));
};

eventStore
	.stream([
		{ kinds: [0, 1, 3, 5, 6, 7, 16, 40, 41, 42, 9734, 10000, 10002, 10005, 10030, 30030, 30078] }
	])
	.subscribe({
		next: nextOnSubscribeEventStore
	});

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
				eventStore.database.deleteEvent(id);
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
	const f = margedFilters.at(0);
	return [{ kinds: [7], '#e': etags, limit: f?.limit, until: f?.until }];
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

const mergeFilter30030: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
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
		const filter = { kinds: [30030], authors: [author], '#d': Array.from(dTagSet) };
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

const flushes$ = new Subject<void>();
const rxReqF = createRxForwardReq();
const rxReqB0 = createRxBackwardReq();
const rxReqB1_42 = createRxBackwardReq();
const rxReqB7 = createRxBackwardReq();
const rxReqB40 = createRxBackwardReq();
const rxReqB41 = createRxBackwardReq();
const rxReqB30030 = createRxBackwardReq();
const rxReqBId = createRxBackwardReq();
const rxReqBRp = createRxBackwardReq();
const batchedReq0 = rxReqB0.pipe(bufferTime(secBufferTime), batch(mergeFilter0));
rxNostr
	.use(batchedReq0, { relays: relaysToUseForProfile })
	.pipe(
		uniq(flushes$),
		latestEach(({ event }) => event.pubkey)
	)
	.subscribe({
		next,
		complete
	});
rxNostr.use(rxReqB1_42).pipe(uniq(flushes$)).subscribe({
	next,
	complete
});
const batchedReq7 = rxReqB7.pipe(bufferTime(secBufferTime), batch(mergeFilter7));
rxNostr.use(batchedReq7).pipe(uniq(flushes$)).subscribe({
	next,
	complete
});
const batchedReq40 = rxReqB40.pipe(bufferTime(secBufferTime), batch(mergeFilter40));
rxNostr.use(batchedReq40, { relays: relaysToUseForChannelMeta }).pipe(uniq(flushes$)).subscribe({
	next,
	complete
});
const batchedReq41 = rxReqB41.pipe(bufferTime(secBufferTime), batch(mergeFilter41));
rxNostr
	.use(batchedReq41, { relays: relaysToUseForChannelMeta })
	.pipe(
		uniq(flushes$),
		latestEach(({ event }) => event.pubkey)
	)
	.subscribe({
		next,
		complete
	});
rxNostr.use(rxReqB30030).pipe(uniq(flushes$)).subscribe({
	next,
	complete
});
const batchedReqId = rxReqBId.pipe(bufferTime(secBufferTime), batch(mergeFilterId));
rxNostr.use(batchedReqId).pipe(uniq(flushes$)).subscribe({
	next,
	complete
});
rxNostr.use(rxReqBRp).pipe(uniq(flushes$)).subscribe({
	next,
	complete
});

const _subTimeline = eventStore
	.stream([{ kinds: [0, 1, 6, 7, 16, 40, 41, 42, 9734, 9735, 10000, 10005, 10030] }])
	.subscribe(async (event) => {
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
			case 6:
			case 16: {
				if (
					event.kind === 16 &&
					event.tags.find((tag) => tag.length >= 2 && tag[0] === 'k')?.at(1) !== '42'
				) {
					break;
				}
				if (!profileMap.has(event.pubkey)) {
					rxReqB0.emit({ kinds: [0], authors: [event.pubkey], until: unixNow() });
				}
				const id = event.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1);
				if (id !== undefined && !eventStore.hasEvent(id)) {
					rxReqBId.emit({ ids: [id], until: unixNow() });
				}
				break;
			}
			case 7: {
				if (!profileMap.has(event.pubkey)) {
					rxReqB0.emit({ kinds: [0], authors: [event.pubkey], until: unixNow() });
				}
				if (
					loginPubkey !== undefined &&
					event.tags.some((tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === loginPubkey)
				) {
					const id = event.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1);
					if (id !== undefined && !eventStore.hasEvent(id)) {
						rxReqBId.emit({ ids: [id], until: unixNow() });
					}
				}
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
			case 42: {
				if (!profileMap.has(event.pubkey)) {
					rxReqB0.emit({ kinds: [0], authors: [event.pubkey], until: unixNow() });
				}
				//多数のリアクションが付くと重くなる
				rxReqB7.emit({ kinds: [7], '#e': [event.id], limit: 10, until: unixNow() });
				const getIdOfMarkerd = (marker: string): string | undefined => {
					return event.tags
						.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === marker)
						?.at(1);
				};
				const rootdId = getIdOfMarkerd('root');
				const repliedId = getIdOfMarkerd('reply');
				if (event.kind === 42) {
					if (rootdId !== undefined && !channelMap.has(rootdId)) {
						rxReqB40.emit({ kinds: [40], ids: [rootdId], until: unixNow() });
					}
					if (repliedId !== undefined && !channelMap.has(repliedId)) {
						rxReqBId.emit({ kinds: [42], ids: [repliedId], until: unixNow() });
					}
				} else if (event.kind === 1) {
					const idToGet = repliedId ?? rootdId;
					if (
						idToGet !== undefined &&
						!eventStore.hasEvent(idToGet) &&
						rootdId !== undefined &&
						(countThread.get(rootdId) ?? 0) < countThreadLimit
					) {
						countThread.set(rootdId, (countThread.get(rootdId) ?? 0) + 1);
						rxReqBId.emit({ ids: [idToGet], until: unixNow() });
					}
				}
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
							'#d': [ap.identifier],
							until: unixNow()
						};
						rxReqBRp.emit(f);
					}
				}
				if (pubkeysFilterd.length > 0) {
					rxReqB0.emit({ kinds: [0], authors: pubkeysFilterd, until: unixNow() });
				}
				break;
			}
			case 9734: {
				if (!profileMap.has(event.pubkey)) {
					rxReqB0.emit({ kinds: [0], authors: [event.pubkey], until: unixNow() });
				}
				if (
					loginPubkey !== undefined &&
					event.tags.some((tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === loginPubkey)
				) {
					const id = event.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1);
					if (id !== undefined && !eventStore.hasEvent(id)) {
						rxReqBId.emit({ ids: [id], until: unixNow() });
					}
				}
				break;
			}
			case 9735: {
				if (loginPubkey === undefined) {
					break;
				}
				const prof = profileMap.get(loginPubkey);
				if (prof === undefined) {
					break;
				}
				const event9734: NostrEvent | null = await getEvent9734(event, prof);
				if (event9734 !== null) {
					eventStore.add(event9734);
					console.info('kind', event9734.kind);
				}
				break;
			}
			case 10000: {
				if (loginPubkey !== undefined) {
					const { pPub, ePub, wPub, pSec, eSec, wSec } = await splitNip51List(event, loginPubkey);
					mutedPubkeys = Array.from(new Set<string>([...pPub, ...pSec]));
					mutedChannelIds = Array.from(new Set<string>([...ePub, ...eSec]));
					mutedWords = Array.from(new Set<string>([...wPub, ...wSec]));
				}
				if (mutedPubkeys.length > 0) {
					rxReqB0.emit({ kinds: [0], authors: mutedPubkeys, until: unixNow() });
				}
				if (mutedChannelIds.length > 0) {
					rxReqB40.emit({ kinds: [40], ids: mutedChannelIds, until: unixNow() });
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
				const atags = event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'a')
					.map((tag) => tag[1]);
				const filterForGetEmoji = [];
				if (atags.length > 0) {
					for (const atag of atags) {
						const ary = atag.split(':');
						const filter: LazyFilter = {
							kinds: [parseInt(ary[0])],
							authors: [ary[1]],
							'#d': [ary[2]],
							until: unixNow()
						};
						filterForGetEmoji.push(filter);
					}
					let margedFilters: LazyFilter[] = [];
					for (const filter of filterForGetEmoji) {
						margedFilters = mergeFilter30030(margedFilters, [filter]);
					}
					const sliceByNumber = (array: LazyFilter[], number: number) => {
						const length = Math.ceil(array.length / number);
						return new Array(length)
							.fill(undefined)
							.map((_, i) => array.slice(i * number, (i + 1) * number));
					};
					for (const filters of sliceByNumber(margedFilters, 10)) {
						rxReqB30030.emit(filters);
					}
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
			{ kinds: [42, 9735], '#p': [loginPubkey], limit: 10, until },
			{ kinds: [7, 16], '#p': [loginPubkey], '#k': ['42'], limit: 10, until }
		];
	} else {
		filters = [{ kinds: [1, 6, 7, 16, 42, 9735], '#p': [loginPubkey], limit: 10, until }];
	}
	const rxReqBFirst = createRxBackwardReq();
	rxNostr.use(rxReqBFirst).pipe(uniq(flushes$), completeOnTimeout(secOnCompleteTimeout)).subscribe({
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
	const filterKinds = [3, 10000, 10002, 10005, 10030];
	if (!profileMap.has(loginPubkey)) {
		filterKinds.push(0);
	}
	const lFilter: LazyFilter = { kinds: filterKinds, authors: [loginPubkey!], until: unixNow() };
	const observable$ = rxNostr.use(rxReqB, { relays: relaysToUseForProfile });
	const obs$ = filterKinds.map((kind) =>
		observable$.pipe(
			filterByKind(kind),
			latestEach(({ event }) => event.pubkey),
			debounceTime(secBufferTime)
		)
	);
	merge(...obs$)
		.pipe(uniq(flushes$))
		.subscribe({
			next,
			complete: completeOnNextFetch
		});
	rxReqB.emit(lFilter);
	rxReqB.over();
};

export const getEventsFirst = (
	urlParams: UrlParams,
	until: number = unixNow(),
	completeCustom: () => void = complete,
	isFirstFetch: boolean = true
): void => {
	const { currentPubkey, currentChannelId, currentNoteId, query, hashtag, isAntenna, isSettings } =
		urlParams;
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
		[currentNoteId, currentPubkey, currentChannelId, hashtag, query].every(
			(q) => q === undefined
		) &&
		!isAntenna &&
		!isSettings;
	const pubkeysFollowing: string[] =
		eventFollowList?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ??
		[];
	if (currentNoteId === undefined && currentPubkey !== undefined) {
		filters.push({ kinds: [1, 6, 16, 42], authors: [currentPubkey] });
	} else if (currentChannelId !== undefined) {
		filters.push({ kinds: [42], '#e': [currentChannelId] });
		filters.push({ kinds: [16], '#k': ['42'] });
	} else if (currentNoteId !== undefined) {
		filters.push({ ids: [currentNoteId] });
	} else if (hashtag !== undefined) {
		filters.push({ kinds: [1, 42], '#t': [hashtag.toLowerCase()] });
	} else if (query !== undefined) {
		options = { relays: searchRelays };
		filters.push({ kinds: [40, 41], search: query });
	} else if (isAntenna) {
		if (pubkeysFollowing.length > 0) {
			filters.push({ kinds: [1, 6, 16, 42], authors: pubkeysFollowing });
			//ブックマークしているチャンネルの投稿も取得したいが、limitで混ぜるのは難しいので考え中
		}
	} else if (isTopPage) {
		filters.push({ kinds: [16, 42] });
	}
	if (isFirstFetch && loginPubkey !== undefined) {
		if (isEnabledSkipKind1) {
			filters.push({ kinds: [42, 9735], '#p': [loginPubkey] });
			filters.push({ kinds: [7, 16], '#p': [loginPubkey], '#k': ['42'] });
		} else {
			filters.push({ kinds: [1, 6, 7, 16, 42, 9735], '#p': [loginPubkey] });
		}
	}
	if (isEnabledSkipKind1) {
		for (const f of filters) {
			if (f.kinds !== undefined) {
				f.kinds = f.kinds?.filter((kind) => ![1, 6].includes(kind));
			}
		}
	}
	for (const f of filters) {
		f.until = until;
		f.limit = 10;
	}
	const rxReqBFirst = createRxBackwardReq();
	rxNostr
		.use(rxReqBFirst, { on: options })
		.pipe(uniq(flushes$), completeOnTimeout(secOnCompleteTimeout))
		.subscribe({
			next,
			complete: completeCustom
		});
	rxReqBFirst.emit(filters);
	rxReqBFirst.over();
	if (currentPubkey !== undefined && isFirstFetch) {
		const rxReqBBookmark = createRxBackwardReq();
		rxNostr
			.use(rxReqBBookmark)
			.pipe(
				uniq(flushes$),
				latestEach(({ event }) => event.pubkey)
			)
			.subscribe({
				next,
				complete
			});
		rxReqBBookmark.emit({ kinds: [10005], authors: [currentPubkey], until });
		rxReqBBookmark.over();
		filters.find((f) => f.authors?.join(':') === currentPubkey)?.kinds?.push(10005);
	}
	//無限スクロール用Reqはここまでで終了
	if (!isFirstFetch) {
		return;
	}
	//ここから先はForwardReq用追加分(受信しっぱなし)
	if (loginPubkey !== undefined) {
		let kinds = [0, 1, 3, 5, 6, 7, 40, 41, 42, 9735, 10000, 10002, 10005, 10030];
		if (!pubkeysFollowing.includes(loginPubkey)) {
			kinds = kinds.concat(16).toSorted((a, b) => a - b);
		}
		filters.push({
			kinds,
			authors: [loginPubkey]
		});
	}
	if (isAntenna && pubkeysFollowing.length > 0) {
		const f = filters.find((f) => f.authors?.join(':') === pubkeysFollowing.join(':'));
		if (f?.kinds !== undefined) {
			f.kinds = f.kinds.concat(0, 7, 40, 41).toSorted((a, b) => a - b);
		}
		if (isEnabledSkipKind1) {
			filters.push({ kinds: [7], '#p': pubkeysFollowing, '#k': ['42'] });
		} else {
			filters.push({ kinds: [7], '#p': pubkeysFollowing });
		}
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
			'#k': (isEnabledSkipKind1 ? [7, 16, 40, 41, 42] : [1, 6, 7, 16, 40, 41, 42]).map((n) =>
				String(n)
			),
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
	subF = rxNostr.use(rxReqF, { on: options }).pipe(uniq(flushes$)).subscribe({
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

export const sendRepost = async (targetEvent: NostrEvent): Promise<void> => {
	if (window.nostr === undefined) {
		return;
	}
	let kind: number = 6;
	const content: string = ''; //魚拓リポストはしない
	const recommendedRelay: string = ''; //TODO リレーヒントはMUST
	const tags: string[][] = [
		['e', targetEvent.id, recommendedRelay],
		['p', targetEvent.pubkey]
	];
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
	const tags: string[][] = [
		...targetEvent.tags.filter(
			(tag) =>
				tag.length >= 2 && (tag[0] === 'e' || (tag[0] === 'p' && tag[1] !== targetEvent.pubkey))
		),
		['e', targetEvent.id],
		['p', targetEvent.pubkey],
		['k', String(targetEvent.kind)]
	];
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

export const sendNote = async (
	content: string,
	channelNameToCreate: string,
	targetEventToReply?: NostrEvent,
	emojiMap?: Map<string, string>,
	contentWarningReason?: string | null | undefined
) => {
	if (window.nostr === undefined) {
		return;
	}
	//チャンネル作成
	let eventChannelToSend: NostrEvent | undefined;
	if (targetEventToReply === undefined && channelNameToCreate.length > 0) {
		const eventTemplateChannel: EventTemplate = $state.snapshot({
			content: JSON.stringify({
				name: channelNameToCreate,
				about: '',
				picture: '',
				relays: relaysToWrite
			}),
			kind: 40,
			tags: isEnabledUseClientTag ? [clientTag] : [],
			created_at: unixNow()
		});
		eventChannelToSend = await window.nostr.signEvent(eventTemplateChannel);
		targetEventToReply = eventChannelToSend;
	}
	//投稿作成
	const recommendeRelay = '';
	const tags: string[][] = [];
	const mentionPubkeys: Set<string> = new Set();
	let pubkeyToReply: string | undefined;
	let kind = targetEventToReply?.kind ?? 1;
	if (kind === 40) {
		kind = 42;
	} else {
		pubkeyToReply = targetEventToReply?.pubkey;
		if (![1, 42].includes(kind)) {
			kind = 1; //暫定
		}
	}
	const rootTag = targetEventToReply?.tags.find(
		(tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root'
	);
	if (rootTag !== undefined) {
		tags.push(rootTag);
		tags.push(['e', targetEventToReply!.id, recommendeRelay, 'reply', targetEventToReply!.pubkey]);
		mentionPubkeys.add(targetEventToReply!.pubkey);
	} else if (targetEventToReply !== undefined) {
		tags.push(['e', targetEventToReply.id, recommendeRelay, 'root', targetEventToReply.pubkey]);
	}
	for (const p of (targetEventToReply?.tags ?? [])
		.filter((tag) => tag.length >= 2 && tag[0] === 'p')
		.map((tag) => tag[1])) {
		mentionPubkeys.add(p);
	}
	const quoteIds: Set<string> = new Set();
	const apsStr: Set<string> = new Set();
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
		} else if (d.type === 'naddr') {
			const str = `${d.data.kind}:${d.data.pubkey}:${d.data.identifier}`;
			if (!apsStr.has(str)) {
				apsStr.add(str);
			}
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
		hashtags.add(match[2]);
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
		tags.push(['q', id]);
	}
	for (const a of apsStr) {
		tags.push(['a', a]);
	}
	for (const p of mentionPubkeys) {
		tags.push(['p', p]);
	}
	for (const t of hashtags) {
		tags.push(['t', t.toLowerCase()]);
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
	const eventTemplate: EventTemplate = $state.snapshot({
		content,
		kind,
		tags,
		created_at: unixNow()
	});
	const eventToSend = await window.nostr.signEvent(eventTemplate);
	const options: Partial<RxNostrSendOptions> = { on: { relays: relaysToWrite } };
	if (eventChannelToSend !== undefined) {
		sendEvent(eventChannelToSend, options);
	}
	sendEvent(eventToSend, options);
};

const sendEvent = (eventToSend: NostrEvent, options?: Partial<RxNostrSendOptions>): void => {
	rxNostr.send(eventToSend, options);
};
