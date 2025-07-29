import {
	bufferTime,
	merge,
	type MonoTypeOperatorFunction,
	type Observable,
	type OperatorFunction,
	type Subscription
} from 'rxjs';
import {
	batch,
	completeOnTimeout,
	createRxBackwardReq,
	createRxForwardReq,
	createRxNostr,
	createTie,
	createUniq,
	latestEach,
	type ConnectionStatePacket,
	type EventPacket,
	type LazyFilter,
	type MergeFilter,
	type OkPacketAgainstEvent,
	type ReqPacket,
	type RetryConfig,
	type RxNostr,
	type RxNostrSendOptions,
	type RxNostrUseOptions,
	type RxReq,
	type RxReqEmittable,
	type RxReqOverable,
	type RxReqPipeable
} from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { EventStore } from 'applesauce-core';
import {
	getAddressPointerForEvent,
	getAddressPointerFromATag,
	getCoordinateFromAddressPointer,
	getDeleteCoordinates,
	getDeleteIds,
	getInboxes,
	getOutboxes,
	getTagValue,
	parseCoordinate,
	unixNow
} from 'applesauce-core/helpers';
import {
	getEventHash,
	sortEvents,
	type EventTemplate,
	type NostrEvent,
	type UnsignedEvent
} from 'nostr-tools/pure';
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds';
import type { RelayRecord } from 'nostr-tools/relay';
import type { Filter } from 'nostr-tools/filter';
import { normalizeURL } from 'nostr-tools/utils';
import * as nip19 from 'nostr-tools/nip19';
import { defaultRelays, indexerRelays, profileRelays, searchRelays } from '$lib/config';
import type { FileUploadResponse } from '$lib/nip96';
import {
	getAddressPointerFromAId,
	getChannelContent,
	getEvent9734,
	getIdsForFilter,
	getPubkeyIfValid,
	getPubkeysForFilter,
	getReadRelaysWithOutboxModel,
	getRelaysToUseFromKind10002Event,
	getTagsForContent,
	isValidEmoji,
	mergeFilterForAddressableEvents,
	splitNip51List,
	type ChannelContent,
	type UrlParams
} from '$lib/utils';

type ReqB = RxReq<'backward'> &
	RxReqEmittable<{
		relays: string[];
	}> &
	RxReqOverable &
	RxReqPipeable;

type ReqF = RxReq<'forward'> & RxReqEmittable & RxReqPipeable;

export class RelayConnector {
	#since: number;
	#rxNostr: RxNostr;
	#eventStore: EventStore;
	#relayRecord: RelayRecord | undefined;
	#rxReqB0: ReqB;
	#rxReqB5: ReqB;
	#rxReqB7: ReqB;
	#rxReqB1111: ReqB;
	#rxReqBId: ReqB;
	#rxReqBRg: ReqB;
	#rxReqBRp: ReqB;
	#rxReqBAd: ReqB;
	#rxReqF: ReqF;
	#rxSubF: Subscription | undefined;
	#deadRelays: string[];
	#blockedRelays: string[];
	#eventsDeletion: NostrEvent[];
	#tie: OperatorFunction<
		EventPacket,
		EventPacket & {
			seenOn: Set<string>;
			isNew: boolean;
		}
	>;
	#seenOn: Map<string, Set<string>>;
	#uniq: MonoTypeOperatorFunction<EventPacket>;
	#eventIds: Set<string>;

	#secOnCompleteTimeout = 1000;
	#secBufferTime = 1000;
	#limitReaction = 500;
	#limitComment = 500;
	#limitRelay = 5;

	constructor(useAuth: boolean, callbackConnectionState: (packet: ConnectionStatePacket) => void) {
		this.#since = unixNow();
		const retry: RetryConfig = {
			strategy: 'exponential',
			maxCount: 3,
			initialDelay: 1000,
			polite: true
		};
		if (useAuth) {
			this.#rxNostr = createRxNostr({ verifier, retry, authenticator: 'auto' });
		} else {
			this.#rxNostr = createRxNostr({ verifier, retry });
		}
		this.#eventStore = new EventStore();
		this.#rxReqB0 = createRxBackwardReq();
		this.#rxReqB5 = createRxBackwardReq();
		this.#rxReqB7 = createRxBackwardReq();
		this.#rxReqB1111 = createRxBackwardReq();
		this.#rxReqBId = createRxBackwardReq();
		this.#rxReqBRg = createRxBackwardReq();
		this.#rxReqBRp = createRxBackwardReq();
		this.#rxReqBAd = createRxBackwardReq();
		this.#rxReqF = createRxForwardReq();
		this.#deadRelays = [];
		this.#blockedRelays = [];
		this.#eventsDeletion = [];
		[this.#tie, this.#seenOn] = createTie();
		[this.#uniq, this.#eventIds] = createUniq((packet: EventPacket): string => packet.event.id);

		this.#rxNostr.setDefaultRelays(defaultRelays);
		this.#rxNostr.createConnectionStateObservable().subscribe(callbackConnectionState);
		this.#defineSubscription();
	}

	dispose = () => {
		this.#seenOn.clear();
		this.#eventIds.clear();
		this.#rxNostr.dispose();
		for (const ev of this.#eventStore.getByFilters({ since: 0 })) {
			this.#eventStore.database.remove(ev);
		}
	};

	get since() {
		return this.#since;
	}

	setDeadRelays = (deadRelays: string[]): void => {
		this.#deadRelays = deadRelays;
	};

	setBlockedRelays = (blockedRelays: string[]): void => {
		this.#blockedRelays = blockedRelays;
	};

	#relayFilter = (relay: string) =>
		URL.canParse(relay) &&
		relay.startsWith('wss://') &&
		!this.#deadRelays.includes(relay) &&
		!this.#blockedRelays.includes(relay);

	getRelayFilter = (): ((relay: string) => boolean) => {
		return this.#relayFilter;
	};

	#defineSubscription = () => {
		const getRpId = ({ event }: { event: NostrEvent }) => `${event.kind}:${event.pubkey}`;
		const getAdId = ({ event }: { event: NostrEvent }) =>
			getCoordinateFromAddressPointer(getAddressPointerForEvent(event));
		const next = this.#next;
		const complete = this.#complete;
		const bt: OperatorFunction<ReqPacket, ReqPacket[]> = bufferTime(this.#secBufferTime);
		const batchedReq0 = this.#rxReqB0.pipe(bt, batch(this.#mergeFilterRp));
		const batchedReq5 = this.#rxReqB5.pipe(bt, batch(this.#mergeFilterRg));
		const batchedReq7 = this.#rxReqB7.pipe(bt, batch(this.#mergeFilterRg));
		const batchedReq1111 = this.#rxReqB1111.pipe(bt, batch(this.#mergeFilter1111));
		const batchedReqId = this.#rxReqBId.pipe(bt, batch(this.#mergeFilterId));
		this.#rxNostr.use(batchedReq0).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq5).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq7).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReq1111).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(batchedReqId).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBRg).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBRp).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBAd).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next,
			complete
		});
		const sub: Subscription = this.#rxNostr
			.use(this.#rxReqF)
			.pipe(this.#tie, this.#uniq)
			.subscribe({
				next,
				complete
			});
		this.#rxSubF?.unsubscribe();
		this.#rxSubF = sub;
	};

	#mergeFilterRp: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const authors = Array.from(new Set<string>(margedFilters.map((f) => f.authors ?? []).flat()));
		const f = margedFilters.at(0);
		return [
			{ kinds: f?.kinds, authors: authors, limit: f?.limit, until: f?.until, since: f?.since }
		];
	};

	#mergeFilterRg: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const etags = Array.from(new Set<string>(margedFilters.map((f) => f['#e'] ?? []).flat()));
		const atags = Array.from(new Set<string>(margedFilters.map((f) => f['#a'] ?? []).flat()));
		const f = margedFilters.at(0);
		const res: LazyFilter[] = [];
		if (f !== undefined) {
			if (etags.length > 0) {
				res.push({ kinds: f.kinds, '#e': etags, limit: f.limit, until: f.until });
			}
			if (atags.length > 0) {
				res.push({ kinds: f.kinds, '#a': atags, limit: f.limit, until: f.until });
			}
		}
		return res;
	};

	#mergeFilter1111: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const Etags = Array.from(new Set<string>(margedFilters.map((f) => f['#E'] ?? []).flat()));
		const Atags = Array.from(new Set<string>(margedFilters.map((f) => f['#A'] ?? []).flat()));
		const f = margedFilters.at(0);
		const res: LazyFilter[] = [];
		if (f !== undefined) {
			if (Etags.length > 0) {
				res.push({ kinds: f.kinds, '#E': Etags, limit: f.limit, until: f.until });
			}
			if (Atags.length > 0) {
				res.push({ kinds: f.kinds, '#A': Atags, limit: f.limit, until: f.until });
			}
		}
		return res;
	};

	#mergeFilterId: MergeFilter = (a: LazyFilter[], b: LazyFilter[]) => {
		const margedFilters = [...a, ...b];
		const ids = Array.from(new Set<string>(margedFilters.map((f) => f.ids ?? []).flat()));
		const f = margedFilters.at(0);
		return [{ ids: ids, limit: f?.limit, until: f?.until, since: f?.since }];
	};

	#next = (packet: EventPacket): void => {
		const event = packet.event;
		if (this.#eventStore.hasEvent(event.id)) {
			console.info('kind', event.kind, 'duplicated');
			return;
		}
		if (this.#getDeletedEventIdSet(this.#eventsDeletion).has(event.id)) {
			console.info('kind', event.kind, 'deleted');
			return;
		}
		console.info('kind', event.kind);
		if (event.kind === 5) {
			const ids: string[] = getDeleteIds(event);
			const aids: string[] = getDeleteCoordinates(event);
			const relaysSeenOnSet = new Set<string>();
			for (const id of ids) {
				if (this.#eventStore.hasEvent(id)) {
					for (const relay of this.getSeenOn(id, true)) {
						relaysSeenOnSet.add(relay);
					}
					this.#eventStore.database.remove(id);
				}
			}
			for (const aid of aids) {
				const ap: nip19.AddressPointer | null = parseCoordinate(aid, true, true);
				if (ap === null) {
					continue;
				}
				const filter: Filter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until: event.created_at
				};
				if (ap.identifier.length > 0) {
					filter['#d'] = [ap.identifier];
				}
				const evs: Set<NostrEvent> = this.#eventStore.getByFilters(filter);
				for (const ev of evs) {
					for (const relay of this.getSeenOn(ev.id, true)) {
						relaysSeenOnSet.add(relay);
					}
					this.#eventStore.database.remove(ev.id);
				}
			}
			for (const relay of this.getSeenOn(event.id, true)) {
				relaysSeenOnSet.delete(relay);
			}
			//削除対象イベント取得元のリレーにkind:5をブロードキャスト
			if (relaysSeenOnSet.size > 0) {
				const options: Partial<RxNostrSendOptions> = {
					on: { relays: Array.from(relaysSeenOnSet) }
				};
				this.#sendEvent(event, options);
			}
		}
		this.#eventStore.add(event);
	};

	#complete = () => {};

	#getDeletedEventIdSet = (eventsDeletion: NostrEvent[]): Set<string> => {
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

	#setFetchListAfter0 = (pubkey: string, fetchAfter0: () => void): void => {
		if (!this.#eventStore.hasReplaceable(0, pubkey)) {
			this.#fetchProfile(pubkey, fetchAfter0);
		} else {
			fetchAfter0();
		}
	};

	#setFetchListAfter10002 = (pubkeys: string[], fetchAfter10002: () => void): void => {
		const pubkeysToFetch = pubkeys.filter(
			(pubkey) => !this.#eventStore.hasReplaceable(10002, pubkey)
		);
		if (pubkeysToFetch.length > 0) {
			this.fetchKind10002(pubkeysToFetch, fetchAfter10002);
		} else {
			fetchAfter10002();
		}
	};

	fetchNext = (
		event: NostrEvent,
		callback: (kind: number, event?: NostrEvent) => void,
		isInTimeline: boolean
	) => {
		const isForwardReq: boolean = this.#since < event.created_at;
		switch (event.kind) {
			case 1:
			case 42:
			case 30023: {
				if ([1, 42].includes(event.kind) && !isInTimeline) {
					break;
				}
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
						this.#fetchReaction(event);
						if (event.kind === 1) {
							this.#fetchReply(event);
						}
					}
					if ([1, 42].includes(event.kind)) {
						this.#fetchEventsByETags(event, 'e', false);
					}
					this.#fetchEventsQuoted(event);
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			case 4: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
					}
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			case 5: {
				this.#eventsDeletion = sortEvents(
					Array.from(this.#eventStore.getByFilters([{ kinds: [5] }]))
				);
				break;
			}
			case 6:
			case 7:
			case 16:
			case 41:
			case 9802: {
				if ([6, 16].includes(event.kind) && !isInTimeline) {
					break;
				}
				const pTag = event.tags.findLast((tag) => tag[0] === 'p');
				const pHint = getPubkeyIfValid(pTag?.at(1));
				const eTag = event.tags.findLast((tag) => tag[0] === 'e');
				const eHint = getPubkeyIfValid(eTag?.at(3)) ?? getPubkeyIfValid(eTag?.at(4));
				const fetchAfter10002 = () => {
					for (const pubkey of pubkeySet) {
						if (!this.#eventStore.hasReplaceable(0, pubkey)) {
							this.#fetchProfile(pubkey);
						}
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
					}
					if (!this.#eventStore.hasEvent(eTag?.at(1) ?? '')) {
						this.#fetchEventsByETags(event, 'e', true, pHint);
					}
					this.#fetchEventsByATags(event, 'a');
				};
				const pubkeySet = new Set<string>([event.pubkey]);
				if (pHint !== undefined) {
					pubkeySet.add(pHint);
				}
				if (eHint !== undefined) {
					pubkeySet.add(eHint);
				}
				this.#setFetchListAfter10002(Array.from(pubkeySet), fetchAfter10002);
				break;
			}
			case 8: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
					}
					this.#fetchEventsByATags(event, 'a');
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			case 40: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchChannelMetadata(event);
					}
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			case 1018: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
					}
					this.#fetchEventsByETags(event, 'e');
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			case 1068: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
						this.#fetchReaction(event);
					}
					const pollExpiration: number = parseInt(
						event.tags
							.find((tag) => tag.length >= 2 && tag[0] === 'endsAt' && /^\d+$/.test(tag[1]))
							?.at(1) ?? '0'
					);
					const filters: Filter[] = [
						{
							kinds: [1018],
							'#e': [event.id],
							until: pollExpiration
						},
						{
							kinds: [1111],
							'#E': [event.id],
							until: unixNow()
						}
					];
					this.#rxReqBRg.emit(filters);
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			case 1111: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
						this.#fetchReaction(event);
					}
					this.#fetchEventsByETags(event, 'E', false);
					this.#fetchEventsByATags(event, 'A');
					this.#fetchEventsQuoted(event);
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			case 9735: {
				const pTag = event.tags.findLast((tag) => tag[0] === 'p');
				const pHint = getPubkeyIfValid(pTag?.at(1));
				const fetchAfter10002 = () => {
					for (const pubkey of pubkeySet) {
						if (!this.#eventStore.hasReplaceable(0, pubkey)) {
							this.#fetchProfile(pubkey);
						}
					}
					const event9734 = getEvent9734(event);
					if (event9734 === null) {
						return;
					}
					const fetchAfter10002next = () => {
						if (!this.#eventStore.hasReplaceable(0, event9734.pubkey)) {
							this.#fetchProfile(event9734.pubkey);
						}
					};
					this.#setFetchListAfter10002([event9734.pubkey], fetchAfter10002next);
				};
				const pubkeySet = new Set<string>([event.pubkey]);
				if (pHint !== undefined) {
					pubkeySet.add(pHint);
				}
				this.#setFetchListAfter10002(Array.from(pubkeySet), fetchAfter10002);
				break;
			}
			case 10001: {
				this.#fetchEventsByETags(event, 'e', false);
				break;
			}
			case 10005: {
				const ids = event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'e')
					.map((tag) => tag[1])
					.filter((id) => !this.#eventStore.hasEvent(id));
				if (ids.length > 0) {
					this.#rxReqBId.emit({ kinds: [40], ids: ids, until: unixNow() });
				}
				break;
			}
			case 10030: {
				this.#fetchEventsByATags(event, 'a');
				break;
			}
			case 30008: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					this.#fetchEventsByETags(event, 'e', false);
					this.#fetchEventsByATags(event, 'a');
				};
				const eTags: string[][] = event.tags.filter((tag) => tag.length >= 4 && tag[0] === 'e');
				const aTags: string[][] = event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'a');
				const pubkeysE: string[] = eTags
					.map((eTag) => getPubkeyIfValid(eTag[3]) ?? getPubkeyIfValid(eTag[4]))
					.filter((pubkey) => pubkey !== undefined) as string[];
				const pubkeysA: string[] = aTags
					.map((aTag) => aTag[1].split(':').at(1))
					.filter((pubkey) => pubkey !== undefined) as string[];
				const pubkeys: string[] = Array.from(new Set<string>([...pubkeysE, ...pubkeysA]));
				this.#setFetchListAfter10002(pubkeys, fetchAfter10002);
				break;
			}
			case 39701: {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
						this.#fetchProfile(event.pubkey);
					}
					if (!isForwardReq) {
						this.#fetchDeletion(event);
						this.#fetchReaction(event);
						this.#fetchComment(event);
					}
					this.#fetchEventsQuoted(event);
				};
				this.#setFetchListAfter10002([event.pubkey], fetchAfter10002);
				break;
			}
			default:
				break;
		}
		callback(event.kind, event);
	};

	subscribeEventStore = (callback: (kind: number, event?: NostrEvent) => void): Subscription => {
		return this.#eventStore
			.filters({ since: 0 }, true)
			.subscribe((event: NostrEvent) => this.fetchNext(event, callback, false));
	};

	#getRelays = (relayType: 'read' | 'write'): string[] => {
		const relaySet = new Set<string>();
		if (this.#relayRecord !== undefined) {
			for (const [relay, _] of Object.entries(this.#relayRecord).filter(([_, obj]) =>
				relayType === 'read' ? obj.read : obj.write
			)) {
				relaySet.add(relay);
			}
		}
		return Array.from(relaySet);
	};

	setRelays = (event?: NostrEvent) => {
		if (event === undefined) {
			this.#relayRecord = undefined;
			this.#rxNostr.setDefaultRelays(defaultRelays);
		} else {
			this.#relayRecord = getRelaysToUseFromKind10002Event(event);
			this.#rxNostr.setDefaultRelays(this.#relayRecord);
		}
	};

	#fetchProfile = (pubkey: string, completeCustom?: () => void, relayHints?: string[]) => {
		const filter: LazyFilter = {
			kinds: [0],
			authors: [pubkey],
			until: unixNow()
		};
		const relaySet = new Set<string>(relayHints ?? []);
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
		if (event10002 !== undefined) {
			const relays = getOutboxes(event10002).filter(this.#relayFilter).slice(0, this.#limitRelay);
			for (const relayUrl of relays) {
				relaySet.add(relayUrl);
			}
		}
		if (relaySet.size === 0) {
			for (const relayUrl of profileRelays.filter(this.#relayFilter)) {
				relaySet.add(relayUrl);
			}
		}
		const relays = Array.from(relaySet);
		const options = relays.length > 0 ? { relays } : undefined;
		if (completeCustom === undefined) {
			this.#rxReqB0.emit(filter, options);
		} else {
			this.#fetchRpCustom(filter, completeCustom, options);
		}
	};

	#fetchDeletion = (event: NostrEvent) => {
		const filter: LazyFilter = { kinds: [5], '#e': [event.id], until: unixNow() };
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getOutboxes(event10002).filter(this.#relayFilter).slice(0, this.#limitRelay);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqB5.emit(filter, options);
	};

	#fetchReaction = (event: NostrEvent) => {
		let filter: LazyFilter;
		const until = unixNow();
		if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = {
				...event,
				identifier: isAddressableKind(event.kind) ? (getTagValue(event, 'd') ?? '') : ''
			};
			filter = {
				kinds: [7],
				'#a': [getCoordinateFromAddressPointer(ap)],
				limit: this.#limitReaction,
				until
			};
		} else {
			filter = { kinds: [7], '#e': [event.id], limit: this.#limitReaction, until };
		}
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getInboxes(event10002).filter(this.#relayFilter).slice(0, this.#limitRelay);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqB7.emit(filter, options);
	};

	#fetchChannelMetadata = (event: NostrEvent) => {
		const until = unixNow();
		const filter: LazyFilter = { kinds: [41], '#e': [event.id], authors: [event.pubkey], until };
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getInboxes(event10002).filter(this.#relayFilter).slice(0, this.#limitRelay);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqBRg.emit(filter, options);
	};

	#fetchReply = (event: NostrEvent) => {
		const filter: LazyFilter = {
			kinds: [1],
			'#e': [event.id],
			limit: this.#limitComment,
			until: unixNow()
		};
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getInboxes(event10002).filter(this.#relayFilter).slice(0, this.#limitRelay);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqBRg.emit(filter, options);
	};

	#fetchComment = (event: NostrEvent) => {
		let filter: LazyFilter;
		const until = unixNow();
		if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
			const ap: nip19.AddressPointer = {
				...event,
				identifier: isAddressableKind(event.kind) ? (getTagValue(event, 'd') ?? '') : ''
			};
			filter = {
				kinds: [1111],
				'#A': [getCoordinateFromAddressPointer(ap)],
				limit: this.#limitComment,
				until
			};
		} else {
			filter = { kinds: [1111], '#E': [event.id], limit: this.#limitComment, until };
		}
		let options: { relays: string[] } | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, event.pubkey);
		if (event10002 !== undefined) {
			const relays = getInboxes(event10002).filter(this.#relayFilter).slice(0, this.#limitRelay);
			options = relays.length > 0 ? { relays } : undefined;
		}
		this.#rxReqB1111.emit(filter, options);
	};

	#getEventsByIdWithRelayHint = (
		event: NostrEvent,
		tagNameToGet: string,
		relaysToExclude: string[],
		onlyLastOne: boolean = false
	) => {
		const until = unixNow();
		if (['e', 'q'].includes(tagNameToGet)) {
			let eTags = event.tags.filter((tag) => tag.length >= 3 && tag[0] === tagNameToGet);
			const eTagLast = eTags.at(-1);
			if (onlyLastOne && eTagLast !== undefined) {
				eTags = [eTagLast];
			}
			for (const eTag of eTags) {
				const id = eTag[1];
				try {
					nip19.neventEncode({ id });
				} catch (_error) {
					continue;
				}
				const relayHint = eTag[2];
				if (
					this.#eventStore.hasEvent(id) ||
					relayHint === undefined ||
					!URL.canParse(relayHint) ||
					!relayHint.startsWith('wss://')
				) {
					continue;
				}
				const relay = normalizeURL(relayHint);
				if (
					relaysToExclude.includes(relay) ||
					this.#deadRelays.includes(relay) ||
					this.#blockedRelays.includes(relay)
				) {
					continue;
				}
				const options: { relays: string[] } = {
					relays: [relay]
				};
				this.#rxReqBId.emit({ ids: [id], until }, options);
			}
		}
		if (['a', 'q'].includes(tagNameToGet)) {
			let aTags = event.tags.filter((tag) => tag.length >= 3 && tag[0] === tagNameToGet);
			const aTagLast = aTags.at(-1);
			if (onlyLastOne && aTagLast !== undefined) {
				aTags = [aTagLast];
			}
			for (const aTag of aTags) {
				let ap: nip19.AddressPointer;
				try {
					ap = getAddressPointerFromATag(aTag);
					nip19.naddrEncode(ap);
				} catch (_error) {
					continue;
				}
				const relayHint = aTag[2];
				if (
					ap === null ||
					this.#eventStore.hasReplaceable(
						ap.kind,
						ap.pubkey,
						isAddressableKind(ap.kind) ? ap.identifier : undefined
					) ||
					relayHint === undefined ||
					!URL.canParse(relayHint) ||
					!relayHint.startsWith('wss://')
				) {
					continue;
				}
				const relay = normalizeURL(relayHint);
				if (
					relaysToExclude.includes(relay) ||
					this.#deadRelays.includes(relay) ||
					this.#blockedRelays.includes(relay)
				) {
					continue;
				}
				const filter: LazyFilter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until
				};
				if (isAddressableKind(ap.kind)) {
					filter['#d'] = [ap.identifier];
				}
				const options: { relays: string[] } = {
					relays: [relay]
				};
				this.#rxReqBAd.emit(filter, options);
			}
		}
	};

	#fetchEventsQuoted = (event: NostrEvent) => {
		const oId = getIdsForFilter([event]);
		const { ids, aps } = oId;
		const idsFiltered = ids.filter((id) => !this.#eventStore.hasEvent(id));
		const apsFiltered = aps.filter(
			(ap) =>
				!this.#eventStore.hasReplaceable(
					ap.kind,
					ap.pubkey,
					isAddressableKind(ap.kind) ? ap.identifier : undefined
				)
		);
		const oPk = getPubkeysForFilter([event]);
		const { pubkeys } = oPk;
		const relaySet = new Set<string>(oId.relays);
		for (const pubkey of pubkeys) {
			const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
			if (event10002 !== undefined) {
				for (const relay of getInboxes(event10002)) {
					relaySet.add(relay);
				}
			}
		}
		const relays = Array.from(relaySet).filter(this.#relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		const until = unixNow();
		if (idsFiltered.length > 0) {
			this.#rxReqBId.emit({ ids: idsFiltered, until }, options);
		}
		if (apsFiltered.length > 0) {
			for (const ap of apsFiltered) {
				const f: LazyFilter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until
				};
				if (isAddressableKind(ap.kind)) {
					f['#d'] = [ap.identifier];
				}
				this.#rxReqBAd.emit(f, options);
			}
		}
		const pubkeysFilterd = pubkeys.filter((pubkey) => !this.#eventStore.hasReplaceable(0, pubkey));
		if (pubkeysFilterd.length > 0) {
			for (const pubkey of pubkeysFilterd) {
				const fetchAfter10002 = () => {
					if (!this.#eventStore.hasReplaceable(0, pubkey)) {
						this.#fetchProfile(pubkey, undefined, oPk.relays);
					}
				};
				this.#setFetchListAfter10002([pubkey], fetchAfter10002);
			}
		}
		//リレーヒント付き引用による取得
		this.#getEventsByIdWithRelayHint(event, 'q', relays, false);
	};

	fetchKind10002 = (pubkeys: string[], completeCustom: () => void) => {
		const filter: LazyFilter = {
			kinds: [10002],
			authors: pubkeys,
			until: unixNow()
		};
		const relays = indexerRelays.filter(this.#relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		this.#fetchRpCustom(filter, completeCustom, options);
	};

	fetchUserSettings = (pubkey: string, completeCustom: () => void) => {
		const filterBase: LazyFilter = {
			authors: [pubkey],
			until: unixNow()
		};
		const filter: LazyFilter = {
			...filterBase,
			kinds: [0, 3, 10000, 10002, 10005, 10006, 10030, 30008]
		};
		const relays = this.#getRelays('write').filter(this.#relayFilter).slice(0, this.#limitRelay);
		const options = relays.length > 0 ? { relays } : undefined;
		this.#fetchRpCustom(filter, completeCustom, options);
	};

	#fetchRpCustom = (
		filter: LazyFilter,
		completeCustom: () => void,
		options?: Partial<RxNostrUseOptions>
	) => {
		const rxReqBRpCustom = createRxBackwardReq();
		this.#rxNostr
			.use(rxReqBRpCustom, options)
			.pipe(
				this.#tie,
				latestEach(({ event }) => `${event.kind}:${event.pubkey}`),
				completeOnTimeout(this.#secOnCompleteTimeout)
			)
			.subscribe({
				next: this.#next,
				complete: completeCustom
			});
		rxReqBRpCustom.emit(filter);
		rxReqBRpCustom.over();
	};

	#getMentionFilter = (
		loginPubkey: string,
		until: number | undefined,
		since: number | undefined,
		limit: number | undefined
	): [LazyFilter, { relays: string[] } | undefined] | null => {
		const filter: LazyFilter = {
			kinds: [1, 4, 6, 7, 8, 16, 42, 1111, 9735, 39701],
			'#p': [loginPubkey],
			until,
			since,
			limit
		};
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, loginPubkey);
		if (event10002 === undefined) {
			return null;
		}
		const relays: string[] = getInboxes(event10002);
		const options = relays.length > 0 ? { relays } : undefined;
		return [filter, options];
	};

	fetchMutedInfo = (mutedChannelIds: string[], mutedPubkeys: string[], loginPubkey: string) => {
		const ev10002 = this.getReplaceableEvent(10002, loginPubkey);
		if (ev10002 !== undefined) {
			const relays = getOutboxes(ev10002);
			const idsExist: string[] = this.getEventsByFilter({ ids: mutedChannelIds }).map(
				(ev) => ev.id
			);
			const idsToFetch: string[] = mutedChannelIds.filter((id) => !idsExist.includes(id));
			if (idsToFetch.length > 0) {
				this.#fetchEventsByIds(idsToFetch, relays);
			}
			for (const pubkey of mutedPubkeys) {
				if (this.getReplaceableEvent(0, pubkey) !== undefined) {
					continue;
				}
				this.#setFetchListAfter10002([pubkey], () => {
					this.#fetchProfile(pubkey);
				});
			}
		}
	};

	fetchEventsMention = (
		loginPubkey: string | undefined,
		until: number,
		limit: number,
		completeCustom?: () => void
	): void => {
		if (loginPubkey === undefined) {
			return;
		}
		const mf = this.#getMentionFilter(loginPubkey, until, undefined, limit);
		if (mf === null) {
			return;
		}
		const [filter, options] = mf;
		const rxReqBFirst = createRxBackwardReq();
		this.#rxNostr
			.use(rxReqBFirst)
			.pipe(this.#tie, this.#uniq, completeOnTimeout(this.#secOnCompleteTimeout))
			.subscribe({
				next: this.#next,
				complete: completeCustom ?? this.#complete
			});
		rxReqBFirst.emit(filter, options);
		rxReqBFirst.over();
	};

	fetchQuotedUserData = (event: NostrEvent): void => {
		const isForwardReq: boolean = this.since < event.created_at;
		this.#setFetchListAfter10002([event.pubkey], () => {
			if (this.getReplaceableEvent(0, event.pubkey) === undefined) {
				this.#fetchProfile(event.pubkey);
			}
			if (!isForwardReq) {
				this.#fetchDeletion(event);
				this.#fetchReaction(event);
			}
			if (event.kind === 1) {
				this.#fetchEventsQuoted(event);
			}
		});
	};

	fetchTimeline = (
		params: UrlParams,
		urlSearchParams: URLSearchParams,
		loginPubkey: string | undefined,
		followingPubkeys: string[],
		limit: number,
		until?: number,
		completeCustom?: () => void
	) => {
		const {
			currentAddressPointer,
			date,
			currentProfilePointer,
			currentEventPointer,
			currentChannelPointer,
			hashtag,
			category,
			query,
			isAntenna,
			isSettings
		} = params;
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
		const now = unixNow();
		const filtersB: LazyFilter[] = [];
		const filterBase: LazyFilter = {
			until: until ?? now,
			limit: until === undefined ? limit : limit + 1
		};
		const kindsBase: number[] = [1, 6, 16, 42, 1068, 1111, 39701];
		const kindSetQ: Set<number> = new Set<number>();
		const authorSetQ: Set<string> = new Set<string>();
		const pSetQ: Set<string> = new Set<string>();
		const relaySetQ: Set<string> = new Set<string>();
		for (const [k, v] of urlSearchParams ?? []) {
			if (k === 'kind' && /^\d+$/.test(v)) {
				const kind = parseInt(v);
				if (0 <= kind && kind <= 65535) {
					kindSetQ.add(kind);
				}
			} else if (k === 'author') {
				authorSetQ.add(v);
			} else if (k === 'p') {
				try {
					const _npub = nip19.npubEncode(v);
				} catch (_error) {
					continue;
				}
				pSetQ.add(v);
			} else if (k === 'relay' && URL.canParse(v) && v.startsWith('wss://')) {
				relaySetQ.add(normalizeURL(v));
			}
		}
		const relaySet: Set<string> = new Set<string>();
		if (currentProfilePointer !== undefined) {
			const f: LazyFilter = {
				...filterBase,
				kinds: kindsBase,
				authors: [currentProfilePointer.pubkey]
			};
			if (date !== undefined) {
				const since = Math.floor(date.getTime() / 1000);
				f.since = since;
				f.until = until ?? since + 24 * 60 * 60;
			}
			filtersB.push(f);
			for (const relay of currentProfilePointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (currentChannelPointer !== undefined) {
			const f1: LazyFilter = { ...filterBase, kinds: [42], '#e': [currentChannelPointer.id] };
			const f2: LazyFilter = { ...filterBase, kinds: [16], '#k': ['42'] };
			filtersB.push(f1, f2);
			for (const relay of currentChannelPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
			const channelEvent: NostrEvent | undefined = this.getEventsByFilter({
				ids: [currentChannelPointer.id]
			}).at(0);
			if (channelEvent !== undefined) {
				const channel: ChannelContent | null = getChannelContent(channelEvent);
				for (const relay of channel?.relays ?? []) {
					relaySet.add(normalizeURL(relay));
				}
			}
		} else if (currentEventPointer !== undefined) {
			const f: LazyFilter = { ...filterBase, ids: [currentEventPointer.id] };
			if (currentEventPointer.kind !== undefined) {
				f.kinds = [currentEventPointer.kind];
			}
			if (currentEventPointer.author !== undefined) {
				f.authors = [currentEventPointer.author];
			}
			filtersB.push(f);
			for (const relay of currentEventPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (currentAddressPointer !== undefined) {
			const f: LazyFilter = {
				...filterBase,
				kinds: [currentAddressPointer.kind],
				authors: [currentAddressPointer.pubkey]
			};
			if (isAddressableKind(currentAddressPointer.kind)) {
				f['#d'] = [currentAddressPointer.identifier];
			}
			filtersB.push(f);
			for (const relay of currentAddressPointer.relays ?? []) {
				relaySet.add(normalizeURL(relay));
			}
		} else if (hashtag !== undefined) {
			const f: LazyFilter = { ...filterBase, kinds: kindsBase, '#t': [hashtag] };
			filtersB.push(f);
		} else if (category !== undefined) {
			const f: LazyFilter = { ...filterBase, kinds: [40, 41], '#t': [category] };
			filtersB.push(f);
		} else if (query !== undefined) {
			for (const relay of searchRelays) {
				relaySet.add(normalizeURL(relay));
			}
			const f: LazyFilter = { ...filterBase, kinds: [40, 41], search: query };
			filtersB.push(f);
		} else if (isAntenna) {
			if (followingPubkeys.length > 0) {
				const f: LazyFilter = { ...filterBase, kinds: kindsBase, authors: followingPubkeys };
				if (date !== undefined) {
					const since = Math.floor(date.getTime() / 1000);
					f.since = since;
					f.until = until ?? since + 24 * 60 * 60;
				}
				filtersB.push(f);
			}
		} else if (isTopPage) {
			const f1: LazyFilter = { ...filterBase, kinds: [42] };
			const f2: LazyFilter = { ...filterBase, kinds: [16], '#k': ['42'] };
			if (followingPubkeys.length > 0 && kindSetQ.size === 0 && pSetQ.size === 0) {
				f1.authors = followingPubkeys;
				f2.authors = followingPubkeys;
			}
			if (kindSetQ.size > 0) {
				filtersB.push(f1);
			} else {
				filtersB.push(f1, f2);
			}
		}
		for (const f of filtersB) {
			if (f.authors === undefined) {
				continue;
			}
			if (f.authors.length >= 2) {
				const relays = getReadRelaysWithOutboxModel(
					f.authors,
					this.getReplaceableEvent,
					this.#relayFilter
				);
				for (const relayUrl of relays) {
					relaySet.add(relayUrl);
				}
			} else {
				for (const pubkey of f.authors) {
					const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
					if (event10002 === undefined) {
						continue;
					}
					const relays = getOutboxes(event10002)
						.filter(this.#relayFilter)
						.slice(0, this.#limitRelay);
					for (const relayUrl of relays) {
						relaySet.add(relayUrl);
					}
				}
			}
		}
		if (relaySet.size === 0) {
			if (followingPubkeys.length > 0) {
				const relays = getReadRelaysWithOutboxModel(
					followingPubkeys,
					this.getReplaceableEvent,
					this.#relayFilter
				);
				for (const relayUrl of relays) {
					relaySet.add(relayUrl);
				}
			} else {
				for (const relay of defaultRelays) {
					relaySet.add(relay);
				}
			}
		}
		for (const filterB of filtersB) {
			if (kindSetQ.size > 0) {
				filterB.kinds = Array.from(kindSetQ);
			}
			if (authorSetQ.size > 0) {
				filterB.authors = Array.from(authorSetQ);
			}
			if (pSetQ.size > 0) {
				filterB['#p'] = Array.from(pSetQ);
			}
		}
		if (relaySetQ.size > 0) {
			relaySet.clear();
			for (const relay of relaySetQ) {
				relaySet.add(relay);
			}
		}
		const relays = Array.from(relaySet).filter(this.#relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		if (completeCustom !== undefined) {
			const rxReqBCustom = createRxBackwardReq();
			this.#rxNostr
				.use(rxReqBCustom)
				.pipe(this.#tie, this.#uniq, completeOnTimeout(this.#secOnCompleteTimeout))
				.subscribe({
					next: this.#next,
					complete: completeCustom
				});
			rxReqBCustom.emit(filtersB, options);
			rxReqBCustom.over();
			return; //追加読み込みはここで終了
		} else {
			for (const filterB of filtersB) {
				if (filterB.kinds?.every((kind) => isAddressableKind(kind))) {
					if (currentAddressPointer === undefined) {
						this.#rxReqBAd.emit(filterB, options);
						if (currentProfilePointer !== undefined) {
							this.#setFetchListAfter0(currentProfilePointer.pubkey, () => {
								const event = this.getReplaceableEvent(0, currentProfilePointer.pubkey);
								if (event !== undefined) {
									this.#fetchEventsQuoted(event);
								}
							});
						}
					} else {
						this.#rxReqBAd.emit(filterB, options);
						if (!this.#eventStore.hasReplaceable(0, currentAddressPointer.pubkey)) {
							this.#fetchProfile(currentAddressPointer.pubkey);
						}
					}
				} else if (filterB.kinds?.every((kind) => isReplaceableKind(kind))) {
					this.#rxReqBRp.emit(filterB, options);
					if (
						currentAddressPointer !== undefined &&
						!this.#eventStore.hasReplaceable(0, currentAddressPointer.pubkey)
					) {
						this.#fetchProfile(currentAddressPointer.pubkey);
					}
				} else if (filterB.ids !== undefined) {
					this.#rxReqBId.emit(filterB, options);
					if (
						currentEventPointer?.author !== undefined &&
						!this.#eventStore.hasReplaceable(0, currentEventPointer.author)
					) {
						this.#fetchProfile(currentEventPointer.author);
					}
				} else {
					this.#rxReqBRg.emit(filterB, options);
				}
			}
			if (currentProfilePointer !== undefined) {
				const authors = [currentProfilePointer.pubkey];
				this.#rxReqBRp.emit({ kinds: [10001, 10005], authors, until: now }, options);
				this.#rxReqBAd.emit(
					{ kinds: [30008], authors, '#d': ['profile_badges'], until: now },
					options
				);
			}
		}
		const since = now + 1;
		const filtersF: LazyFilter[] = [];
		for (const filterB of filtersB) {
			const filterF: LazyFilter = { ...filterB };
			delete filterF.until;
			delete filterF.limit;
			filterF.since = since;
			filtersF.push(filterF);
		}
		if (loginPubkey !== undefined) {
			filtersF.push({
				kinds: [
					0, 1, 3, 4, 5, 6, 7, 16, 40, 41, 42, 1018, 1068, 1111, 10000, 10001, 10002, 10005, 10006,
					10030, 30008, 39701
				],
				authors: [loginPubkey],
				since
			});
			//kind:30078 は署名時刻がブレるので全時刻取得すべき
			filtersF.push({
				kinds: [30078],
				'#d': ['nostter-read'],
				authors: [loginPubkey]
			});
		}
		if (currentProfilePointer !== undefined) {
			filtersF.push({ kinds: [7], '#p': [currentProfilePointer.pubkey], since });
		} else if (currentChannelPointer !== undefined) {
			filtersF.push({ kinds: [7], '#k': ['42'], '#e': [currentChannelPointer.id], since });
		} else if (currentEventPointer !== undefined) {
			filtersF.push({ kinds: [7], '#e': [currentEventPointer.id], since });
		} else if (currentAddressPointer !== undefined) {
			filtersF.push({
				kinds: [7],
				'#a': [getCoordinateFromAddressPointer(currentAddressPointer)],
				since
			});
		} else if (isAntenna && followingPubkeys.length > 0) {
			const f = filtersF.find((f) => f.authors?.join(':') === followingPubkeys.join(':'));
			if (f?.kinds !== undefined) {
				f.kinds = f.kinds.concat(0, 7, 40, 41).toSorted((a, b) => a - b);
			}
			filtersF.push({ kinds: [7], '#p': followingPubkeys, since });
		} else if (isTopPage) {
			filtersF.push({ kinds: [7], '#k': ['42'], since });
		}
		const authorsOfFilters: string[] = filtersF.map((f) => f.authors ?? []).flat();
		if (authorsOfFilters.length > 0) {
			//削除反映漏れに備えて kind:5 は少し前から取得する
			filtersF.push({
				kinds: [5],
				'#k': [1, 4, 6, 7, 8, 16, 40, 41, 42, 1018, 1068, 1111, 39701].map((n) => String(n)),
				authors: authorsOfFilters,
				since: since - 60 * 60 * 12,
				limit: 10
			});
		}
		if (loginPubkey === undefined) {
			this.#rxNostr.setDefaultRelays(relays);
			this.#rxReqF.emit(filtersF);
			return;
		}
		const mf = this.#getMentionFilter(loginPubkey, undefined, since, undefined);
		if (mf === null) {
			this.#rxNostr.setDefaultRelays(relays);
			this.#rxReqF.emit(filtersF);
			return;
		}
		const [filterMention, optionsMention] = mf;
		const reqTL: ReqF = createRxForwardReq();
		const reqMention: ReqF = createRxForwardReq();
		const sub: Subscription = merge(
			this.#rxNostr.use(reqTL, options),
			this.#rxNostr.use(reqMention, optionsMention)
		)
			.pipe(this.#tie, this.#uniq)
			.subscribe({
				next: this.#next,
				complete: this.#complete
			});
		this.#rxSubF?.unsubscribe();
		this.#rxSubF = sub;
		this.#rxNostr.setDefaultRelays(relays);
		reqTL.emit(filtersF);
		reqMention.emit(filterMention);
	};

	#fetchEventsByIds = (ids: string[], relays: string[]) => {
		const options = relays.length > 0 ? { relays } : undefined;
		this.#rxReqBId.emit({ ids, until: unixNow() }, options);
	};

	#fetchEventsByETags = (
		event: NostrEvent,
		tagName: string,
		onlyLastOne: boolean = false,
		pubkeyHint?: string
	) => {
		let ids = event.tags
			.filter((tag) => tag.length >= 2 && tag[0] === tagName)
			.map((tag) => tag[1])
			.filter((id) => !this.#eventStore.hasEvent(id));
		if (ids.length > 0) {
			const lastOne: string | undefined = ids.at(-1);
			if (onlyLastOne && lastOne !== undefined) {
				ids = [lastOne];
			}
			for (const id of ids) {
				const eTag: string[] | undefined = event.tags.findLast(
					(tag) => tag.length >= 2 && tag[0] === 'e' && tag[1] === id
				);
				if (eTag === undefined) {
					continue;
				}
				const relaySet: Set<string> = new Set<string>();
				const relayHint: string | undefined = eTag.at(2);
				if (relayHint !== undefined && URL.canParse(relayHint)) {
					relaySet.add(normalizeURL(relayHint));
				}
				const pubkeyToUse1: string | undefined =
					getPubkeyIfValid(eTag[3]) ?? getPubkeyIfValid(eTag[4]) ?? pubkeyHint;
				const pubkeyToUse2: string = event.pubkey;
				const event10002 =
					pubkeyToUse1 === undefined ? undefined : this.getReplaceableEvent(10002, pubkeyToUse1);
				if (event10002 !== undefined) {
					for (const relay of getOutboxes(event10002)) {
						relaySet.add(relay);
					}
				} else {
					const event10002 = this.getReplaceableEvent(10002, pubkeyToUse2);
					if (event10002 !== undefined) {
						for (const relay of getOutboxes(event10002)) {
							relaySet.add(relay);
						}
					}
				}
				const relays = Array.from(relaySet).filter(this.#relayFilter);
				if (relays.length > 0) {
					const options = { relays };
					this.#rxReqBId.emit({ ids, until: unixNow() }, options);
				}
			}
		}
	};

	#fetchEventsByATags = (event: NostrEvent, tagName: string) => {
		const aTags = event.tags.filter((tag) => tag.length >= 2 && tag[0] === tagName && !!tag[1]);
		if (aTags.length === 0) {
			return;
		}
		const filters: LazyFilter[] = [];
		const until = unixNow();
		for (const aTag of aTags) {
			let ap: nip19.AddressPointer;
			try {
				ap = getAddressPointerFromATag(aTag);
				nip19.naddrEncode(ap);
			} catch (error) {
				console.warn(error);
				continue;
			}
			if (
				!this.#eventStore.hasReplaceable(
					ap.kind,
					ap.pubkey,
					isAddressableKind(ap.kind) ? ap.identifier : undefined
				)
			) {
				const filter: LazyFilter = {
					kinds: [ap.kind],
					authors: [ap.pubkey],
					until
				};
				if (isAddressableKind(ap.kind)) {
					filter['#d'] = [ap.identifier];
				}
				filters.push(filter);
			}
		}
		const mergedFilters: LazyFilter[] = mergeFilterForAddressableEvents(filters);
		const sliceByNumber = (array: LazyFilter[], number: number) => {
			const length = Math.ceil(array.length / number);
			return new Array(length)
				.fill(undefined)
				.map((_, i) => array.slice(i * number, (i + 1) * number));
		};
		const relayHints: string[] = Array.from(
			new Set<string>(
				event.tags
					.filter((tag) => tag.length >= 3 && tag[0] === tagName && URL.canParse(tag[2]))
					.map((tag) => normalizeURL(tag[2]))
			)
		);
		const relaySet = new Set<string>(relayHints);
		for (const pubkey of new Set<string>(filters.map((f) => f.authors ?? []).flat())) {
			const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, pubkey);
			if (event10002 !== undefined) {
				for (const relay of getOutboxes(event10002)) {
					relaySet.add(relay);
				}
			}
		}
		const relays = Array.from(relaySet).filter(this.#relayFilter);
		const options = relays.length > 0 ? { relays } : undefined;
		for (const filters of sliceByNumber(mergedFilters, 10)) {
			this.#rxReqBAd.emit(filters, options);
		}
	};

	getEventsByFilter = (filters: Filter | Filter[]): NostrEvent[] => {
		return Array.from(this.#eventStore.getByFilters(filters));
	};

	getReplaceableEvent = (kind: number, pubkey: string, d?: string): NostrEvent | undefined => {
		return this.#eventStore.getReplaceable(kind, pubkey, d);
	};

	getQuotedEvents = (eventsAll: NostrEvent[], depth: number): NostrEvent[] => {
		const ids: string[] = Array.from(
			new Set<string>(
				eventsAll
					.filter((ev) => ev.tags.some((tag) => tag.length >= 2 && ['e', 'q'].includes(tag[0])))
					.map((ev) => ev.tags.map((tag) => tag[1]))
					.flat()
			)
		);
		const eventsFromId: NostrEvent[] = this.getEventsByFilter({ ids });
		const aids: string[] = Array.from(
			new Set<string>(
				eventsAll
					.filter((ev) => ev.tags.some((tag) => tag.length >= 2 && ['a', 'q'].includes(tag[0])))
					.map((ev) => ev.tags.map((tag) => tag[1]))
					.flat()
			)
		).filter((aid) => aid !== undefined);
		const aps: nip19.AddressPointer[] = aids
			.map((aid) => getAddressPointerFromAId(aid))
			.filter((aid) => aid !== null) as nip19.AddressPointer[];
		const eventsFromAId: NostrEvent[] = aps
			.map((ap) => this.getReplaceableEvent(ap.kind, ap.pubkey, ap.identifier))
			.filter((ev) => ev !== undefined) as NostrEvent[];
		const eventsRepliedE: NostrEvent[] = this.getEventsByFilter({
			'#e': eventsAll.map((ev) => ev.id)
		});
		const eventsRepliedA: NostrEvent[] = this.getEventsByFilter({
			'#a': eventsAll
				.filter((ev) => isReplaceableKind(ev.kind) || isAddressableKind(ev.kind))
				.map((ev) => `${ev.kind}:${ev.pubkey}:${getTagValue(ev, 'd') ?? ''}`)
		});
		const eventMap = new Map<string, NostrEvent>();
		for (const event of [...eventsFromId, ...eventsFromAId, ...eventsRepliedE, ...eventsRepliedA]) {
			eventMap.set(event.id, event);
		}
		const res: NostrEvent[] = Array.from(eventMap.values());
		const depthNext = depth - 1;
		if (depthNext > 0) {
			return [...res, ...this.getQuotedEvents(res, depthNext)];
		} else {
			return res;
		}
	};

	getSeenOn = (id: string, excludeWs: boolean): string[] => {
		const s = this.#seenOn.get(id);
		if (s === undefined) {
			return [];
		}
		if (excludeWs) {
			return Array.from(s)
				.filter((relay) => relay.startsWith('wss://'))
				.map((url) => normalizeURL(url));
		}
		return Array.from(s).map((url) => normalizeURL(url));
	};

	#getRelayHintEvent = (targetEvent: NostrEvent, relays?: string[]): string | undefined => {
		let relayHintEvent: string | undefined;
		const event10002: NostrEvent | undefined = this.getReplaceableEvent(10002, targetEvent.pubkey);
		const relaysSeenOn: string[] = this.getSeenOn(targetEvent.id, true).filter(this.#relayFilter);
		const outboxRelays: string[] = event10002 === undefined ? [] : getOutboxes(event10002);
		//取得済かつwriteリレーに含まれる
		relayHintEvent = relaysSeenOn.filter((relay) => outboxRelays.includes(relay)).at(0);
		//取得済
		if (relayHintEvent === undefined && relaysSeenOn.length > 0) {
			relayHintEvent = relaysSeenOn.at(0);
		}
		//エンコードに含まれるかつwriteリレーに含まれる
		if (relayHintEvent === undefined && relays !== undefined) {
			const relaysFiltered: string[] = relays.map(normalizeURL).filter(this.#relayFilter);
			relayHintEvent = relaysFiltered.filter((relay) => outboxRelays.includes(relay)).at(0);
			//エンコードに含まれる
			if (relayHintEvent === undefined) {
				relayHintEvent = relaysFiltered.at(0);
			}
		}
		return relayHintEvent;
	};

	#getRelayHintAuhor = (pubkey: string, relays?: string[]): string | undefined => {
		let relayHintAuthor: string | undefined;
		const event0 = this.getReplaceableEvent(0, pubkey);
		const event10002 = this.getReplaceableEvent(10002, pubkey);
		const outboxRelays: string[] = event10002 === undefined ? [] : getOutboxes(event10002);
		//kind0が取得済かつwriteリレーに含まれる
		if (event0 !== undefined) {
			relayHintAuthor = this.getSeenOn(event0.id, true)
				.filter(this.#relayFilter)
				.filter((relay) => !profileRelays.includes(relay) && outboxRelays.includes(relay))
				.at(0);
		}
		//エンコードに含まれるかつwriteリレーに含まれる
		if (relayHintAuthor === undefined && relays !== undefined) {
			const relaysFiltered: string[] = relays.map(normalizeURL).filter(this.#relayFilter);
			relayHintAuthor = relaysFiltered.filter((relay) => outboxRelays.includes(relay)).at(0);
		}
		return relayHintAuthor;
	};

	signAndSendEvent = async (
		eventTemplate: EventTemplate
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	followPubkey = async (
		pubkey: string,
		eventFollowList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = 3;
		let tags: string[][];
		const content: string = eventFollowList?.content ?? '';
		if (eventFollowList === undefined) {
			tags = [['p', pubkey]];
		} else if (
			eventFollowList.tags.some((tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey)
		) {
			throw new Error('pubkey already exists');
		} else {
			tags = [...eventFollowList.tags, ['p', pubkey]];
		}
		for (const pTag of tags.filter((tag) => tag.length >= 2 && tag[0] === 'p')) {
			const relayHintAuthor = this.#getRelayHintAuhor(pTag[1]);
			if (relayHintAuthor !== undefined) {
				pTag[2] = relayHintAuthor;
			}
			if (pTag[2] === '' && pTag.length === 3) {
				delete pTag[2];
			}
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unfollowPubkey = async (
		pubkey: string,
		eventFollowList: NostrEvent
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = eventFollowList.kind;
		let tags: string[][];
		const content: string = eventFollowList.content;
		if (
			eventFollowList.tags.some((tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey)
		) {
			tags = [
				...eventFollowList.tags.filter(
					(tag) => !(tag.length >= 2 && tag[0] === 'p' && tag[1] === pubkey)
				)
			];
		} else {
			throw new Error('pubkey does not exist');
		}
		for (const pTag of tags.filter((tag) => tag.length >= 2 && tag[0] === 'p')) {
			const relayHintAuthor = this.#getRelayHintAuhor(pTag[1]);
			if (relayHintAuthor !== undefined) {
				pTag[2] = relayHintAuthor;
			}
			if (pTag[2] === '' && pTag.length === 3) {
				delete pTag[2];
			}
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	mutePubkey = async (
		pubkey: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr.nip04 is undefined');
		}
		const kind = 10000;
		let tags: string[][];
		let content: string;
		const pTag: string[] = ['p', pubkey];
		const recommendedRelay: string | undefined = this.#getRelayHintAuhor(pubkey);
		if (recommendedRelay !== undefined) {
			pTag.push(recommendedRelay);
		}
		if (eventMuteList === undefined) {
			tags = [];
			content = await window.nostr.nip04.encrypt(loginPubkey, JSON.stringify([pTag]));
		} else {
			const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
			tags = tagList;
			content = await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify([...contentList, pTag])
			);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unmutePubkey = async (
		pubkey: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr.nip04 is undefined');
		}
		if (eventMuteList === undefined) {
			throw new Error('kind:10000 event does not exist');
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
		const eventTemplate: EventTemplate = {
			kind: eventMuteList.kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	muteChannel = async (
		channel: ChannelContent,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr.nip04 is undefined');
		}
		const kind = 10000;
		let tags: string[][];
		let content: string;
		const recommendedRelay: string | undefined = this.#getRelayHintEvent(channel.eventkind40);
		const eTag: string[] = ['e', channel.id, recommendedRelay ?? '', channel.pubkey];
		if (eventMuteList === undefined) {
			tags = [];
			content = await window.nostr.nip04.encrypt(loginPubkey, JSON.stringify([eTag]));
		} else {
			const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
			tags = tagList;
			content = await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify([...contentList, eTag])
			);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unmuteChannel = async (
		channelId: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr.nip04 is undefined');
		}
		if (eventMuteList === undefined) {
			throw new Error('kind:10000 event does not exist');
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
						contentList.filter(
							(tag) => !(tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId)
						)
					)
				);
		const eventTemplate: EventTemplate = {
			kind: eventMuteList.kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unmuteWord = async (
		word: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr is undefined');
		}
		if (eventMuteList === undefined) {
			throw new Error('kind:10000 event does not exist');
		}
		const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
		const tags: string[][] = tagList.filter(
			(tag) => !(tag.length >= 2 && tag[0] === 'word' && tag[1] === word)
		);
		const content: string = !contentList.some(
			(tag) => tag.length >= 2 && tag[0] === 'word' && tag[1] === word
		)
			? eventMuteList.content
			: await window.nostr.nip04.encrypt(
					loginPubkey,
					JSON.stringify(
						contentList.filter((tag) => !(tag.length >= 2 && tag[0] === 'word' && tag[1] === word))
					)
				);
		const eventTemplate: EventTemplate = {
			kind: eventMuteList.kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	muteHashtag = async (
		hashtag: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = 10000;
		let tags: string[][];
		let content: string;
		if (eventMuteList === undefined) {
			tags = [];
			content = await window.nostr.nip04.encrypt(loginPubkey, JSON.stringify([['t', hashtag]]));
		} else {
			const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
			tags = tagList;
			content = await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify([...contentList, ['t', hashtag]])
			);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unmuteHashtag = async (
		hashtag: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr is undefined');
		}
		if (eventMuteList === undefined) {
			throw new Error('kind:10000 event does not exist');
		}
		const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
		const tags: string[][] = tagList.filter(
			(tag) => !(tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag)
		);
		const content: string = !contentList.some(
			(tag) => tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag
		)
			? eventMuteList.content
			: await window.nostr.nip04.encrypt(
					loginPubkey,
					JSON.stringify(
						contentList.filter(
							(tag) => !(tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag)
						)
					)
				);
		const eventTemplate: EventTemplate = {
			kind: eventMuteList.kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	bookmarkChannel = async (
		channel: ChannelContent,
		eventMyPublicChatsList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = 10005;
		let tags: string[][];
		let content: string;
		const recommendedRelay: string | undefined = this.#getRelayHintEvent(channel.eventkind40);
		const eTag: string[] = ['e', channel.id, recommendedRelay ?? '', channel.pubkey];
		if (eventMyPublicChatsList === undefined) {
			tags = [eTag];
			content = '';
		} else {
			tags = [...eventMyPublicChatsList.tags, eTag];
			content = eventMyPublicChatsList.content;
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unbookmarkChannel = async (
		channelId: string,
		loginPubkey: string,
		eventMyPublicChatsList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr.nip04 is undefined');
		}
		if (eventMyPublicChatsList === undefined) {
			throw new Error('kind:10005 event does not exist');
		}
		const { tagList, contentList } = await splitNip51List(eventMyPublicChatsList, loginPubkey);
		const tags: string[][] = [
			...tagList.filter((tag) => !(tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId))
		];
		const content: string = !contentList.some(
			(tag) => tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId
		)
			? eventMyPublicChatsList.content
			: await window.nostr.nip04.encrypt(
					loginPubkey,
					JSON.stringify(
						contentList.filter(
							(tag) => !(tag.length >= 2 && tag[0] === 'e' && tag[1] === channelId)
						)
					)
				);
		const eventTemplate: EventTemplate = {
			kind: eventMyPublicChatsList.kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	bookmarkEmojiSets = async (
		eventEmojiSet: NostrEvent,
		eventEmojiSetList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = 10030;
		let tags: string[][];
		let content: string;
		const aTagStrs = eventEmojiSetList?.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'a')
			.map((tag) => tag[1]);
		const aTagStr: string = getCoordinateFromAddressPointer(
			getAddressPointerForEvent(eventEmojiSet)
		);
		const aTag = ['a', aTagStr];
		const recommendedRelay: string | undefined = this.#getRelayHintEvent(eventEmojiSet);
		if (recommendedRelay !== undefined) {
			aTag.push(recommendedRelay);
		}
		if (eventEmojiSetList === undefined || aTagStrs === undefined) {
			tags = [aTag];
			content = '';
		} else if (aTagStrs.includes(aTagStr)) {
			throw new Error('already bookmarked');
		} else {
			tags = [...eventEmojiSetList.tags, aTag];
			content = eventEmojiSetList.content;
		}
		for (const tag of tags.filter((tag) => tag.length >= 2 && tag[0] === 'a')) {
			const ap: nip19.AddressPointer | null = getAddressPointerFromAId(tag[1]);
			if (ap !== null) {
				const event30030: NostrEvent | undefined = this.getReplaceableEvent(
					ap.kind,
					ap.pubkey,
					ap.identifier
				);
				if (event30030 !== undefined) {
					const relayHint = this.#getRelayHintEvent(event30030);
					if (relayHint !== undefined) {
						tag[2] = relayHint;
					} else {
						delete tag[2];
					}
				} else {
					delete tag[2];
				}
			} else {
				delete tag[2];
			}
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unbookmarkEmojiSets = async (
		aTagStr: string,
		eventEmojiSetList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const aTags = eventEmojiSetList?.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'a')
			.map((tag) => tag[1]);
		if (eventEmojiSetList === undefined || aTags === undefined) {
			throw new Error('kind:10030 event does not exist');
		} else if (!aTags.includes(aTagStr)) {
			throw new Error('not bookmarked yet');
		}
		const tags: string[][] = [
			...eventEmojiSetList.tags.filter(
				(tag) => !(tag.length >= 2 && tag[0] === 'a' && tag[1] === aTagStr)
			)
		];
		for (const tag of tags.filter((tag) => tag.length >= 2 && tag[0] === 'a')) {
			const ap: nip19.AddressPointer | null = getAddressPointerFromAId(tag[1]);
			if (ap !== null) {
				const event30030: NostrEvent | undefined = this.getReplaceableEvent(
					ap.kind,
					ap.pubkey,
					ap.identifier
				);
				if (event30030 !== undefined) {
					const relayHint = this.getSeenOn(event30030.id, true).at(0);
					if (relayHint !== undefined) {
						tag[2] = relayHint;
					} else {
						delete tag[2];
					}
				} else {
					delete tag[2];
				}
			} else {
				delete tag[2];
			}
		}
		const content: string = eventEmojiSetList.content;
		const eventTemplate: EventTemplate = {
			kind: eventEmojiSetList.kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	bookmarkBadge = async (
		profileBadgesEvent: NostrEvent | undefined,
		badgeDefinitionEvent: NostrEvent,
		badgeAwardEvent: NostrEvent
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = 30008;
		let tags: string[][];
		let content: string;
		const aTagStrs = profileBadgesEvent?.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'a')
			.map((tag) => tag[1]);
		const aTagStr: string = getCoordinateFromAddressPointer(
			getAddressPointerForEvent(badgeDefinitionEvent)
		);
		const aTag: string[] = ['a', aTagStr];
		const recommendedRelayATag: string | undefined = this.#getRelayHintEvent(badgeDefinitionEvent);
		if (recommendedRelayATag !== undefined) {
			aTag.push(recommendedRelayATag);
		}
		const recommendedRelayETag: string | undefined = this.#getRelayHintEvent(badgeAwardEvent);
		const eTag: string[] = [
			'e',
			badgeAwardEvent.id,
			recommendedRelayETag ?? '',
			badgeAwardEvent.pubkey
		];
		if (profileBadgesEvent === undefined || aTagStrs === undefined) {
			const dTag = ['d', 'profile_badges'];
			tags = [dTag, aTag, eTag];
			content = '';
		} else if (aTagStrs.includes(aTagStr)) {
			throw new Error('already bookmarked');
		} else {
			tags = [...profileBadgesEvent.tags, aTag, eTag];
			content = profileBadgesEvent.content;
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	unbookmarkBadge = async (
		profileBadgesEvent: NostrEvent | undefined,
		aTagStr: string,
		eTagStr: string
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const aTags = profileBadgesEvent?.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'a')
			.map((tag) => tag[1]);
		if (profileBadgesEvent === undefined || aTags === undefined) {
			throw new Error('kind:30008 profile_badges event does not exist');
		} else if (!aTags.includes(aTagStr)) {
			throw new Error('not bookmarked yet');
		}
		const tags: string[][] = [
			...profileBadgesEvent.tags.filter(
				(tag) =>
					!(
						(tag.length >= 2 && tag[0] === 'a' && tag[1] === aTagStr) ||
						(tag.length >= 2 && tag[0] === 'e' && tag[1] === eTagStr)
					)
			)
		];
		const content: string = profileBadgesEvent.content;
		const eventTemplate: EventTemplate = {
			kind: profileBadgesEvent.kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	sendReadTime = async (time: number): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const tags = [['d', 'nostter-read']];
		const eventTemplate: EventTemplate = {
			kind: 30078,
			tags,
			content: '',
			created_at: time
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	sendChannelEdit = async (
		channel: ChannelContent,
		isEnabledEventProtection: boolean,
		clientTag: string[] | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const contentBase: string = channel.eventkind41?.content ?? channel.eventkind40.content;
		const obj = JSON.parse(contentBase);
		obj.name = channel.name;
		obj.about = channel.about ?? '';
		obj.picture = channel.picture ?? '';
		obj.relays = this.#getRelays('write').filter(this.#relayFilter);
		const content = JSON.stringify(obj);
		const relayHintEvent: string | undefined = this.#getRelayHintEvent(channel.eventkind40);
		const eTag = ['e', channel.id, relayHintEvent ?? '', channel.pubkey];
		const tags: string[][] = [eTag];
		for (const tTag of new Set<string>(channel.categories)) {
			tags.push(['t', tTag]);
		}
		if (isEnabledEventProtection) {
			tags.push(['-']);
		}
		if (clientTag !== undefined) {
			tags.push(clientTag);
		}
		const eventTemplate: EventTemplate = {
			content,
			kind: 41,
			tags,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	sendPollResponse = async (
		targetEventToRespond: NostrEvent,
		responses: string[],
		isEnabledEventProtection: boolean,
		clientTag: string[] | undefined,
		relaysToWriteCustom?: string[]
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const content = '';
		const kind = 1018;
		const relayHintEvent: string | undefined = this.#getRelayHintEvent(targetEventToRespond);
		const tags: string[][] = [
			['e', targetEventToRespond.id, relayHintEvent ?? '', targetEventToRespond.pubkey],
			...responses.map((response) => ['response', response])
		];
		if (isEnabledEventProtection) {
			tags.push(['-']);
		}
		if (clientTag !== undefined) {
			tags.push(clientTag);
		}
		const eventTemplate: EventTemplate = {
			content,
			kind,
			tags,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		const relaySet: Set<string> = new Set<string>([
			...this.#getRelays('write'),
			...(relaysToWriteCustom ?? [])
		]);
		const relays = Array.from(relaySet);
		const options: Partial<RxNostrSendOptions> | undefined =
			relays.length > 0 ? { on: { relays } } : undefined;
		return this.#sendEvent(eventToSend, options);
	};

	sendRepost = async (
		targetEvent: NostrEvent,
		isEnabledEventProtection: boolean,
		clientTag: string[] | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		let kind: number = 6;
		const content: string = ''; //魚拓リポストはしない
		const tags: string[][] = [];
		const relayHintEvent: string | undefined = this.#getRelayHintEvent(targetEvent);
		const relayHintAuthor: string | undefined = this.#getRelayHintAuhor(targetEvent.pubkey);
		if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
			const ap: nip19.AddressPointer = {
				...targetEvent,
				identifier: isAddressableKind(targetEvent.kind) ? (getTagValue(targetEvent, 'd') ?? '') : ''
			};
			const a: string = getCoordinateFromAddressPointer(ap);
			const aTag: string[] = ['a', a];
			if (relayHintEvent !== undefined) {
				aTag.push(relayHintEvent);
			}
			tags.push(aTag);
		}
		const eTag: string[] = ['e', targetEvent.id, relayHintEvent ?? '', targetEvent.pubkey];
		const pTag: string[] = ['p', targetEvent.pubkey];
		if (relayHintAuthor !== undefined) {
			pTag.push(relayHintAuthor);
		}
		tags.push(eTag, pTag);
		if (targetEvent.kind !== 1) {
			kind = 16;
			const kTag: string[] = ['k', String(targetEvent.kind)];
			tags.push(kTag);
		}
		if (isEnabledEventProtection) {
			tags.push(['-']);
		}
		if (clientTag !== undefined) {
			tags.push(clientTag);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend);
	};

	sendReaction = async (
		target: NostrEvent | string,
		content: string,
		emojiurl: string | undefined,
		clientTag: string[] | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		let targetEvent: NostrEvent | undefined;
		let targetUrl: string | undefined;
		let kind: number;
		const tags: string[][] = [];
		if (typeof target !== 'string') {
			targetEvent = target;
			kind = 7;
			const relayHintEvent: string | undefined = this.#getRelayHintEvent(targetEvent);
			const relayHintAuthor: string | undefined = this.#getRelayHintAuhor(targetEvent.pubkey);
			if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
				const ap: nip19.AddressPointer = {
					...targetEvent,
					identifier: isAddressableKind(targetEvent.kind)
						? (getTagValue(targetEvent, 'd') ?? '')
						: ''
				};
				const a: string = getCoordinateFromAddressPointer(ap);
				const aTag: string[] = ['a', a];
				if (relayHintEvent !== undefined) {
					aTag.push(relayHintEvent);
				}
				tags.push(aTag);
			}
			const eTag: string[] = ['e', targetEvent.id, relayHintEvent ?? '', targetEvent.pubkey];
			const pTag: string[] = ['p', targetEvent.pubkey];
			if (relayHintAuthor !== undefined) {
				pTag.push(relayHintAuthor);
			}
			const kTag: string[] = ['k', String(targetEvent.kind)];
			tags.push(eTag, pTag, kTag);
		} else {
			targetUrl = target;
			kind = 17;
			tags.push(['r', targetUrl]);
		}
		if (emojiurl !== undefined && URL.canParse(emojiurl)) {
			tags.push(['emoji', content.replaceAll(':', ''), emojiurl]);
		}
		if (clientTag !== undefined) {
			tags.push(clientTag);
		}
		const eventTemplate: EventTemplate = {
			kind,
			tags,
			content,
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		if (!isValidEmoji(eventToSend)) {
			throw new TypeError('emoji is invalid');
		}
		return this.sendEventWithInboxRelays(eventToSend);
	};

	sendDeletion = async (targetEvent: NostrEvent): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		if ([5, 62].includes(targetEvent.kind)) {
			throw new TypeError(`cannot delete kind:${targetEvent.kind} event`);
		}
		const tags = [
			['e', targetEvent.id],
			['k', String(targetEvent.kind)]
		];
		const eventTemplate: EventTemplate = {
			kind: 5,
			tags,
			content: '',
			created_at: unixNow()
		};
		const eventToSend = await window.nostr.signEvent(eventTemplate);
		return this.sendEventWithInboxRelays(eventToSend, targetEvent);
	};

	makeEvent = (
		loginPubkey: string,
		content: string,
		channelNameToCreate: string,
		pubkeysExcluded: string[],
		isEnabledEventProtection: boolean,
		clientTag: string[] | undefined,
		channelMap: Map<string, ChannelContent>,
		eventsEmojiSet: NostrEvent[],
		targetEventToReply?: NostrEvent,
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
		const created_at = unixNow();
		const relaysToWrite = this.#getRelays('write')
			.filter(this.#relayFilter)
			.slice(0, this.#limitRelay);
		let eventChannelToSend: UnsignedEvent | undefined;
		if (kindForEdit !== undefined || (pollItems !== undefined && pollItems.length > 0)) {
			//do nothing
		} else if (targetEventToReply === undefined && channelNameToCreate.length > 0) {
			//チャンネル作成
			const tagsChannel: string[][] = [];
			if (isEnabledEventProtection) {
				tagsChannel.push(['-']);
			}
			if (clientTag !== undefined) {
				tagsChannel.push(clientTag);
			}
			const eventTemplateChannel: UnsignedEvent = {
				content: JSON.stringify({
					name: channelNameToCreate,
					about: '',
					picture: '',
					relays: relaysToWrite
				}),
				kind: 40,
				tags: tagsChannel,
				created_at,
				pubkey: loginPubkey
			};
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
			for (const relayUrl of channel?.relays ?? []) {
				relaysToAdd.add(relayUrl);
			}
		}
		//投稿作成
		let tags: string[][] = [];
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
				...relaysToWrite
					.filter((relay) => relay.startsWith('wss://'))
					.slice(0, 10)
					.map((relay) => ['relay', relay]),
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
			if ([1, 42].includes(targetEventToReply.kind)) {
				kind = targetEventToReply.kind;
			} else {
				kind = 1111;
			}
		}
		let pTagToReply: string[] | undefined;
		if (targetEventToReply === undefined) {
			//do nothing
		} else if ([1, 40, 42].includes(targetEventToReply.kind)) {
			const rootTag = targetEventToReply.tags.find(
				(tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root'
			);
			const relayHintEvent: string | undefined = this.#getRelayHintEvent(targetEventToReply);
			if (rootTag !== undefined) {
				tags.push(rootTag);
				tags.push([
					'e',
					targetEventToReply.id,
					relayHintEvent ?? '',
					'reply',
					targetEventToReply.pubkey
				]);
			} else {
				tags.push([
					'e',
					targetEventToReply.id,
					relayHintEvent ?? '',
					'root',
					targetEventToReply.pubkey
				]);
			}
			for (const pTag of targetEventToReply.tags.filter(
				(tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] !== targetEventToReply?.pubkey
			)) {
				tags.push(pTag);
			}
			const relayHintAuthor: string | undefined = this.#getRelayHintAuhor(
				targetEventToReply.pubkey
			);
			if (targetEventToReply.kind !== 40) {
				pTagToReply = ['p', targetEventToReply.pubkey];
				if (relayHintAuthor !== undefined) {
					pTagToReply.push(relayHintAuthor);
				}
			}
		} else {
			const tags: string[][] = [];
			const relayHintEvent: string | undefined = this.#getRelayHintEvent(targetEventToReply);
			const relayHintAuthor: string | undefined = this.#getRelayHintAuhor(
				targetEventToReply.pubkey
			);
			pTagToReply = ['p', targetEventToReply.pubkey];
			const PTag: string[] = ['P', targetEventToReply.pubkey];
			if (relayHintAuthor !== undefined) {
				pTagToReply.push(relayHintAuthor);
				PTag.push(relayHintAuthor);
			}
			const kTag: string[] = ['k', String(targetEventToReply.kind)];
			const KTag: string[] = ['K', String(targetEventToReply.kind)];
			const eTag: string[] = [
				'e',
				targetEventToReply.id,
				relayHintEvent ?? '',
				targetEventToReply.pubkey
			];
			const ETag: string[] = [
				'E',
				targetEventToReply.id,
				relayHintEvent ?? '',
				targetEventToReply.pubkey
			];
			if (targetEventToReply.kind === 1111) {
				const tagsCopied = targetEventToReply.tags.filter(
					(tag) => tag.length >= 2 && ['A', 'E', 'I', 'K', 'P'].includes(tag[0])
				);
				for (const tag of tagsCopied) {
					tags.push([...tag]);
				}
				tags.push(eTag);
				tags.push(kTag);
			} else if (
				isReplaceableKind(targetEventToReply.kind) ||
				isAddressableKind(targetEventToReply.kind)
			) {
				const ap: nip19.AddressPointer = {
					...targetEventToReply,
					identifier: isAddressableKind(targetEventToReply.kind)
						? (getTagValue(targetEventToReply, 'd') ?? '')
						: ''
				};
				const a: string = getCoordinateFromAddressPointer(ap);
				const aTag: string[] = ['a', a];
				const ATag: string[] = ['A', a];
				if (relayHintEvent !== undefined) {
					aTag.push(relayHintEvent);
					ATag.push(relayHintEvent);
				}
				tags.push(ATag, KTag, PTag, aTag, eTag, kTag);
			} else {
				tags.push(ETag, KTag, PTag, eTag, kTag);
			}
		}
		const tagsForContent: string[][] = getTagsForContent(
			content,
			eventsEmojiSet,
			this.#getRelayHintEvent,
			this.#getRelayHintAuhor,
			this.getEventsByFilter,
			this.getReplaceableEvent,
			imetaMap
		).filter((tag) => !(tag[0] === 'p' && tag[1] === targetEventToReply?.pubkey));
		tags.push(...tagsForContent);
		if (pTagToReply !== undefined) {
			tags.push(pTagToReply);
		}
		tags = tags.filter(
			(tag) => !(tag.length >= 2 && tag[0] === 'p' && pubkeysExcluded.includes(tag[1]))
		);
		if (contentWarningReason !== undefined) {
			tags.push(
				contentWarningReason === null
					? ['content-warning']
					: ['content-warning', contentWarningReason]
			);
		}
		if (isEnabledEventProtection) {
			tags.push(['-']);
		}
		if (clientTag !== undefined) {
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
							r.push(tag[3]);
						}
					}
					return r;
				});
		}
		const eventToSend: UnsignedEvent = {
			content,
			kind,
			tags,
			created_at,
			pubkey: loginPubkey
		};
		for (const relayUrl of relaysToWrite) {
			relaysToAdd.add(relayUrl);
		}
		for (const pubkey of tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1])) {
			const relayRecord: RelayRecord = getRelaysToUseFromKind10002Event(
				this.getReplaceableEvent(10002, pubkey)
			);
			for (const [relayUrl, _] of Object.entries(relayRecord).filter(([_, obj]) => obj.read)) {
				relaysToAdd.add(relayUrl);
			}
		}
		const options: Partial<RxNostrSendOptions> = { on: { relays: Array.from(relaysToAdd) } };
		return { eventToSend, eventChannelToSend, options };
	};

	sendNote = async (
		loginPubkey: string,
		content: string,
		channelNameToCreate: string,
		pubkeysExcluded: string[],
		isEnabledEventProtection: boolean,
		clientTag: string[] | undefined,
		channelMap: Map<string, ChannelContent>,
		eventsEmojiSet: NostrEvent[],
		targetEventToReply?: NostrEvent,
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
		const { eventToSend, eventChannelToSend, options } = this.makeEvent(
			loginPubkey,
			content,
			channelNameToCreate,
			pubkeysExcluded,
			isEnabledEventProtection,
			clientTag,
			channelMap,
			eventsEmojiSet,
			targetEventToReply,
			imetaMap,
			contentWarningReason,
			pollItems,
			pollEndsAt,
			pollType,
			kindForEdit
		);
		if (eventChannelToSend !== undefined) {
			const signedEventChannelToSend = await window.nostr.signEvent(eventChannelToSend);
			this.#sendEvent(signedEventChannelToSend, options);
		}
		const signedEventToSend = await window.nostr.signEvent(eventToSend);
		this.#sendEvent(signedEventToSend, options);
		return signedEventToSend;
	};

	#getInboxRelaysOfPTags = (event: NostrEvent): string[] => {
		const relaySet: Set<string> = new Set<string>();
		const mentionedPubkeys: string[] = event.tags
			.filter((tag) => tag.length >= 2 && ['p', 'P'].includes(tag[0]))
			.map((tag) => tag[1]);
		for (const pubkey of mentionedPubkeys) {
			const event10002: NostrEvent | undefined = this.#eventStore.getReplaceable(10002, pubkey);
			if (event10002 === undefined) {
				continue;
			}
			for (const relayUrl of getInboxes(event10002)) {
				relaySet.add(relayUrl);
			}
		}
		return Array.from(relaySet).filter(this.#relayFilter);
	};

	getRelaysToBroadcast = (eventToSend: NostrEvent, targetEvent?: NostrEvent): string[] => {
		const relaySet: Set<string> = new Set<string>([
			...this.#getRelays('write'),
			...this.#getInboxRelaysOfPTags(targetEvent ?? eventToSend)
		]);
		const relays = Array.from(relaySet);
		return relays;
	};

	sendEventWithInboxRelays = (
		eventToSend: NostrEvent,
		targetEvent?: NostrEvent
	): Observable<OkPacketAgainstEvent> => {
		const relays = this.getRelaysToBroadcast(eventToSend, targetEvent);
		const options: Partial<RxNostrSendOptions> | undefined =
			relays.length > 0 ? { on: { relays } } : undefined;
		return this.#sendEvent(eventToSend, options);
	};

	#sendEvent = (
		eventToSend: NostrEvent,
		options?: Partial<RxNostrSendOptions>
	): Observable<OkPacketAgainstEvent> => {
		const sub: Observable<OkPacketAgainstEvent> = this.#rxNostr.send(eventToSend, options);
		sub.subscribe((packet) => {
			const relay = normalizeURL(packet.from);
			const mark = packet.ok ? '🟢' : '🔴';
			console.info(`${mark}${relay}`);
		});
		return sub;
	};
}
