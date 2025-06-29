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
import {
	defaultRelays,
	indexerRelays,
	initialFetchDelay,
	profileRelays,
	searchRelays
} from '$lib/config';
import type { FileUploadResponse } from '$lib/nip96';
import {
	getAddressPointerFromAId,
	getChannelContent,
	getIdsForFilter,
	getPubkeyIfValid,
	getPubkeysForFilter,
	getReadRelaysWithOutboxModel,
	getRelaysToUseFromKind10002Event,
	getTagsForContent,
	isValidEmoji,
	mergeFilterForAddressableEvents,
	splitNip51List,
	urlLinkString,
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
	#rxReqBIdQ: ReqB;
	#rxReqBRg: ReqB;
	#rxReqBRp: ReqB;
	#rxReqBRpQ: ReqB;
	#rxReqBAd: ReqB;
	#rxReqBAdQ: ReqB;
	#rxReqF: ReqF;
	#deadRelays: string[];
	#blockedRelays: string[];
	#eventsDeletion: NostrEvent[];
	#callbackQuote: (event: NostrEvent) => void;
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
	#limitReaction = 20;
	#limitComment = 100;
	#limitRelay = 5;

	constructor(
		useAuth: boolean,
		callbackConnectionState: (packet: ConnectionStatePacket) => void,
		callbackQuote: (event: NostrEvent) => void
	) {
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
		this.#rxReqBIdQ = createRxBackwardReq();
		this.#rxReqBRg = createRxBackwardReq();
		this.#rxReqBRp = createRxBackwardReq();
		this.#rxReqBRpQ = createRxBackwardReq();
		this.#rxReqBAd = createRxBackwardReq();
		this.#rxReqBAdQ = createRxBackwardReq();
		this.#rxReqF = createRxForwardReq();
		this.#deadRelays = [];
		this.#blockedRelays = [];
		this.#eventsDeletion = [];
		this.#callbackQuote = callbackQuote;
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
		const batchedReqIdQ = this.#rxReqBIdQ.pipe(bt, batch(this.#mergeFilterId));
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
		this.#rxNostr.use(batchedReqIdQ).pipe(this.#tie, this.#uniq).subscribe({
			next: this.#nextCallbackQuote,
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
		this.#rxNostr.use(this.#rxReqBRpQ).pipe(this.#tie, latestEach(getRpId)).subscribe({
			next: this.#nextCallbackQuote,
			complete
		});
		this.#rxNostr.use(this.#rxReqBAd).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next,
			complete
		});
		this.#rxNostr.use(this.#rxReqBAdQ).pipe(this.#tie, latestEach(getAdId)).subscribe({
			next: this.#nextCallbackQuote,
			complete
		});
		this.#rxNostr.use(this.#rxReqF).pipe(this.#tie, this.#uniq).subscribe({
			next,
			complete
		});
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

	#nextCallbackQuote = (packet: EventPacket): void => {
		this.#callbackQuote(packet.event);
		this.#next(packet);
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

	subscribeEventStore = (callback: (kind: number, event?: NostrEvent) => void): Subscription => {
		return this.#eventStore.filters({ since: 0 }, true).subscribe((event: NostrEvent) => {
			const isForwardReq: boolean = this.#since < event.created_at;
			switch (event.kind) {
				case 1:
				case 42: {
					const fetchAfter10002 = () => {
						if (!this.#eventStore.hasReplaceable(0, event.pubkey)) {
							this.#fetchProfile(event.pubkey);
						}
						if (!isForwardReq) {
							this.#fetchDeletion(event);
							this.#fetchReaction(event);
						}
						this.#fetchEventsByETags(event, 'e', false);
						this.#fetchEventsQuoted(event);
						if (event.kind === 1) {
							this.#fetchReply(event);
						}
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
						const eventTarget = this.#eventStore.getEvent(eTag?.at(1) ?? '');
						if (eventTarget !== undefined) {
							this.#callbackQuote(eventTarget);
						} else {
							this.#fetchEventsByETags(event, 'e', true, pHint);
						}
						const aid = getTagValue(event, 'a');
						if (aid !== undefined) {
							const ap = getAddressPointerFromAId(aid);
							if (ap !== null) {
								const eventTarget = this.#eventStore.getReplaceable(
									ap.kind,
									ap.pubkey,
									ap.identifier
								);
								if (eventTarget !== undefined) {
									this.#callbackQuote(eventTarget);
								}
								this.#fetchEventsByATags(event, 'a');
							}
						}
					};
					const pubkeySet = new Set<string>(event.pubkey);
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
					this.#setFetchListAfter10002(Array.from([event.pubkey]), fetchAfter10002);
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
						this.#rxReqBIdQ.emit({ kinds: [40], ids: ids, until: unixNow() });
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
		});
	};

	#getRelaysToUseFromKind10002Event = (event: NostrEvent): RelayRecord => {
		const newRelays: RelayRecord = {};
		for (const tag of event.tags.filter(
			(tag) => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1])
		)) {
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
			this.#relayRecord = this.#getRelaysToUseFromKind10002Event(event);
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
				this.#rxReqBIdQ.emit({ ids: [id], until }, options);
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
				this.#rxReqBAdQ.emit(filter, options);
			}
		}
	};

	#fetchEventsQuoted = (event: NostrEvent) => {
		const oId = getIdsForFilter([event]);
		const { ids, aps } = oId;
		for (const id of ids) {
			const event = this.#eventStore.getEvent(id);
			if (event !== undefined) {
				this.#callbackQuote(event);
			}
		}
		for (const ap of aps) {
			const event = this.#eventStore.getReplaceable(ap.kind, ap.pubkey, ap.identifier);
			if (event !== undefined) {
				this.#callbackQuote(event);
			}
		}
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
			this.#rxReqBIdQ.emit({ ids: idsFiltered, until }, options);
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
				this.#rxReqBAdQ.emit(f, options);
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
		const filter1: LazyFilter = {
			...filterBase,
			kinds: [0, 3, 10000, 10002, 10005, 10006]
		};
		const filter2: LazyFilter = {
			...filterBase,
			kinds: [10030, 30008]
		};
		const relays = this.#getRelays('write').filter(this.#relayFilter).slice(0, this.#limitRelay);
		const options = relays.length > 0 ? { relays } : undefined;
		this.#fetchRpCustom(filter1, completeCustom, options);
		setTimeout(() => {
			this.#fetchRpCustom(filter2, () => {}, options);
		}, initialFetchDelay);
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
				next: this.#nextCallbackQuote,
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
			kinds: [1, 4, 6, 7, 16, 42, 1111, 9735, 39701],
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
		until?: number,
		completeCustom?: () => void
	) => {
		const {
			currentAddressPointer,
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
			limit: until === undefined ? 10 : 11
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
				filtersB.push(f);
			}
		} else if (isTopPage) {
			const f1: LazyFilter = { ...filterBase, kinds: [42] };
			const f2: LazyFilter = { ...filterBase, kinds: [16], '#k': ['42'] };
			if (followingPubkeys.length > 0) {
				f1.authors = followingPubkeys;
				f2.authors = followingPubkeys;
			}
			filtersB.push(f1, f2);
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
						this.#rxReqBAdQ.emit(filterB, options);
						if (!this.#eventStore.hasReplaceable(0, currentAddressPointer.pubkey)) {
							this.#fetchProfile(currentAddressPointer.pubkey);
						}
					}
				} else if (filterB.kinds?.every((kind) => isReplaceableKind(kind))) {
					this.#rxReqBRpQ.emit(filterB, options);
					if (
						currentAddressPointer !== undefined &&
						!this.#eventStore.hasReplaceable(0, currentAddressPointer.pubkey)
					) {
						this.#fetchProfile(currentAddressPointer.pubkey);
					}
				} else if (filterB.ids !== undefined) {
					this.#rxReqBIdQ.emit(filterB, options);
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
				this.#rxReqBRpQ.emit({ kinds: [10001, 10005], authors, until: now }, options);
				this.#rxReqBAdQ.emit(
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
		merge(this.#rxNostr.use(reqTL, options), this.#rxNostr.use(reqMention, optionsMention))
			.pipe(this.#tie, this.#uniq)
			.subscribe({
				next: (value: EventPacket) =>
					value.event.tags.some(
						(tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === loginPubkey
					) || [8, 1018].includes(value.event.kind)
						? this.#nextCallbackQuote(value)
						: this.#next(value),
				complete: this.#complete
			});
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
				const pubkeyToUse: string =
					getPubkeyIfValid(eTag[3]) ?? getPubkeyIfValid(eTag[4]) ?? pubkeyHint ?? event.pubkey;
				const event10002 = this.getReplaceableEvent(10002, pubkeyToUse);
				if (event10002 !== undefined) {
					for (const relay of getOutboxes(event10002)) {
						relaySet.add(relay);
					}
				}
				const relays = Array.from(relaySet).filter(this.#relayFilter);
				if (relays.length > 0) {
					const options = { relays };
					this.#rxReqBIdQ.emit({ ids, until: unixNow() }, options);
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
			this.#rxReqBAdQ.emit(filters, options);
		}
	};

	getEventsByFilter = (filters: Filter | Filter[]): NostrEvent[] => {
		return Array.from(this.#eventStore.getByFilters(filters));
	};

	getReplaceableEvent = (kind: number, pubkey: string, d?: string): NostrEvent | undefined => {
		return this.#eventStore.getReplaceable(kind, pubkey, d);
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
			const event0 = this.getReplaceableEvent(0, pTag[1]);
			if (event0 !== undefined) {
				const relayHint = this.getSeenOn(event0.id, true)
					.filter((relay) => !profileRelays.includes(relay))
					.at(0);
				if (relayHint !== undefined) {
					pTag[2] = relayHint;
				}
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
			const event0 = this.getReplaceableEvent(0, pTag[1]);
			if (event0 !== undefined) {
				const relayHint = this.getSeenOn(event0.id, true)
					.filter((relay) => !profileRelays.includes(relay))
					.at(0);
				if (relayHint !== undefined) {
					pTag[2] = relayHint;
				}
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
		if (eventMuteList === undefined) {
			tags = [];
			content = await window.nostr.nip04.encrypt(loginPubkey, JSON.stringify([['p', pubkey]]));
		} else {
			const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
			tags = tagList;
			content = await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify([...contentList, ['p', pubkey]])
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
		channelId: string,
		loginPubkey: string,
		eventMuteList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr?.nip04 === undefined) {
			throw new Error('window.nostr.nip04 is undefined');
		}
		const kind = 10000;
		let tags: string[][];
		let content: string;
		if (eventMuteList === undefined) {
			tags = [];
			content = await window.nostr.nip04.encrypt(loginPubkey, JSON.stringify([['e', channelId]]));
		} else {
			const { tagList, contentList } = await splitNip51List(eventMuteList, loginPubkey);
			tags = tagList;
			content = await window.nostr.nip04.encrypt(
				loginPubkey,
				JSON.stringify([...contentList, ['e', channelId]])
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
		channelId: string,
		eventMyPublicChatsList: NostrEvent | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = 10005;
		let tags: string[][];
		let content: string;
		if (eventMyPublicChatsList === undefined) {
			tags = [['e', channelId]];
			content = '';
		} else {
			const getList = (tags: string[][], tagName: string): string[] =>
				tags.filter((tag) => tag.length >= 2 && tag[0] === tagName).map((tag) => tag[1]);
			const ePub = getList(eventMyPublicChatsList.tags, 'e');
			tags = [...ePub.map((id) => ['e', id]), ['e', channelId]];
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
		aTagStr: string,
		recommendedRelay: string | undefined,
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
		const aTag = ['a', aTagStr];
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
		aTagStr: string,
		recommendedRelayATag: string | undefined,
		eTagStr: string,
		recommendedRelayETag: string | undefined
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
		const recommendedRelay: string = this.getSeenOn(channel.id, true).at(0) ?? '';
		const eTag = ['e', channel.id, recommendedRelay, channel.pubkey];
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
		const tags: string[][] = [
			['e', targetEventToRespond.id],
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

	sendComment = async (
		content: string,
		targetEvent: NostrEvent,
		eventsEmojiSet: NostrEvent[],
		contentWarning: string | boolean,
		clientTag: string[] | undefined
	): Promise<Observable<OkPacketAgainstEvent>> => {
		if (window.nostr === undefined) {
			throw new Error('window.nostr is undefined');
		}
		const kind = 1111;
		const tags: string[][] = [];
		const relayHintEvent: string = this.getSeenOn(targetEvent.id, true).at(0) ?? '';
		const relayHintAuthor: string =
			this.getSeenOn(this.getReplaceableEvent(0, targetEvent.pubkey)?.id ?? '', true).at(0) ?? '';
		const pTag = ['p', targetEvent.pubkey, relayHintAuthor];
		if (targetEvent.kind === 1111) {
			const tagsCopied = targetEvent.tags.filter(
				(tag) => tag.length >= 2 && ['A', 'E', 'I', 'K', 'P'].includes(tag[0])
			);
			for (const tag of tagsCopied) {
				tags.push([...tag]);
			}
			tags.push(['e', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['k', String(targetEvent.kind)]);
		} else if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
			const ap: nip19.AddressPointer = {
				...targetEvent,
				identifier: isAddressableKind(targetEvent.kind) ? (getTagValue(targetEvent, 'd') ?? '') : ''
			};
			const a: string = getCoordinateFromAddressPointer(ap);
			tags.push(['A', a, relayHintEvent]);
			tags.push(['K', String(targetEvent.kind)]);
			tags.push(['P', targetEvent.pubkey, relayHintAuthor]);
			tags.push(['a', a, relayHintEvent]);
			tags.push(['e', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['k', String(targetEvent.kind)]);
		} else {
			tags.push(['E', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['K', String(targetEvent.kind)]);
			tags.push(['P', targetEvent.pubkey, relayHintAuthor]);
			tags.push(['e', targetEvent.id, relayHintEvent, targetEvent.pubkey]);
			tags.push(['k', String(targetEvent.kind)]);
		}
		for (const tag of getTagsForContent(
			content,
			eventsEmojiSet,
			this.getSeenOn,
			this.getEventsByFilter,
			this.getReplaceableEvent
		).filter((tag) => !(tag[0] === 'p' && tag[1] === targetEvent.pubkey))) {
			tags.push(tag);
		}
		tags.push(pTag);
		if (contentWarning !== false) {
			if (contentWarning === true) {
				tags.push(['content-warning']);
			} else {
				tags.push(['content-warning', contentWarning]);
			}
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
		const recommendedRelay: string = this.getSeenOn(targetEvent.id, true).at(0) ?? '';
		if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
			const d = targetEvent.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
			tags.push(['a', `${targetEvent.kind}:${targetEvent.pubkey}:${d}`, recommendedRelay]);
		}
		tags.push(
			['e', targetEvent.id, recommendedRelay, '', targetEvent.pubkey],
			['p', targetEvent.pubkey]
		);
		if (targetEvent.kind !== 1) {
			kind = 16;
			tags.push(['k', String(targetEvent.kind)]);
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
			const relayHintEvent: string = this.getSeenOn(targetEvent.id, true).at(0) ?? '';
			const relayHintAuthor: string =
				this.getSeenOn(this.getReplaceableEvent(0, targetEvent.pubkey)?.id ?? '', true).at(0) ?? '';
			if (isReplaceableKind(targetEvent.kind) || isAddressableKind(targetEvent.kind)) {
				const ap: nip19.AddressPointer = {
					...targetEvent,
					identifier: isAddressableKind(targetEvent.kind)
						? (getTagValue(targetEvent, 'd') ?? '')
						: ''
				};
				const a: string = getCoordinateFromAddressPointer(ap);
				tags.push(['a', a, relayHintEvent]);
			}
			tags.push(
				['e', targetEvent.id, relayHintEvent, targetEvent.pubkey],
				['p', targetEvent.pubkey, relayHintAuthor],
				['k', String(targetEvent.kind)]
			);
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
		const recommendedRelay: string =
			targetEventToReply === undefined
				? ''
				: (this.getSeenOn(targetEventToReply.id, true).at(0) ?? '');
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
				tags.push([
					'e',
					targetEventToReply.id,
					recommendedRelay,
					'reply',
					targetEventToReply.pubkey
				]);
				mentionPubkeys.add(targetEventToReply.pubkey);
			} else {
				tags.push([
					'e',
					targetEventToReply.id,
					recommendedRelay,
					'root',
					targetEventToReply.pubkey
				]);
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
			const recommendedRelayForQuote: string | undefined = this.getSeenOn(id, true).at(0);
			if (recommendedRelayForQuote !== undefined) {
				qTag.push(recommendedRelayForQuote);
				const pubkeyForQuote: string | undefined = this.getEventsByFilter({ ids: [id] }).at(
					0
				)?.pubkey;
				if (pubkeyForQuote !== undefined) {
					qTag.push(pubkeyForQuote);
				}
			}
			tags.push(qTag);
			const ev = this.getEventsByFilter({ ids: [id] }).at(0);
			if (ev !== undefined) {
				mentionPubkeys.add(ev.pubkey);
			}
		}
		for (const [a, ap] of apsMap) {
			const aTag: string[] = ['q', a];
			const ev: NostrEvent | undefined = this.getReplaceableEvent(
				ap.kind,
				ap.pubkey,
				ap.identifier
			);
			const recommendedRelayForQuote: string | undefined =
				this.getSeenOn(ev?.id ?? '', true).at(0) ??
				ap.relays?.filter((relay) => relay.startsWith('wss://')).at(0);
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
							r.push('');
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
		const { eventToSend, eventChannelToSend, options } = this.makeEvent(
			loginPubkey,
			content,
			channelNameToCreate,
			pubkeysExcluded,
			isEnabledEventProtection,
			clientTag,
			channelMap,
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
