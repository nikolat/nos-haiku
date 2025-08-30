<script lang="ts">
	import {
		getBlockedRelaysList,
		getChannelMap,
		getEventsAddressableLatest,
		getEventsFilteredByMute,
		getMuteList,
		mergeFilterForAddressableEvents,
		type ChannelContent,
		type ProfileContentEvent,
		type UrlParams
	} from '$lib/utils';
	import { defaultKindsSelected, initialLocale, uploaderURLs } from '$lib/config';
	import {
		getDeadRelays,
		getLoginPubkey,
		getRelayConnector,
		getSubscription,
		setDeadRelays,
		setLoginPubkey,
		setRelayConnector,
		setSubscription
	} from '$lib/resource.svelte';
	import { RelayConnector } from '$lib/resource';
	import Header from '$lib/components/Header.svelte';
	import Settings from '$lib/components/Settings.svelte';
	import Search from '$lib/components/Search.svelte';
	import Page from '$lib/components/Page.svelte';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { sortEvents, type NostrEvent } from 'nostr-tools/pure';
	import { isAddressableKind } from 'nostr-tools/kinds';
	import type { Filter } from 'nostr-tools/filter';
	import { normalizeURL } from 'nostr-tools/utils';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		getAddressPointerFromATag,
		getProfileContent,
		getTagValue,
		isValidProfile,
		unixNow
	} from 'applesauce-core/helpers';
	import type { Subscription } from 'rxjs';
	import '$lib/haiku.css';
	import { _, locale } from 'svelte-i18n';
	import type { Unsubscriber } from 'svelte/store';
	import { preferences } from '$lib/store';
	import type { ConnectionStatePacket } from 'rx-nostr';

	const {
		up
	}: {
		up: UrlParams;
	} = $props();

	const isTopPage = $derived(
		[
			up.currentEventPointer,
			up.currentProfilePointer,
			up.currentChannelPointer,
			up.currentAddressPointer,
			up.hashtag,
			up.category,
			up.query
		].every((q) => q === undefined) &&
			!up.isAntenna &&
			!up.isSettings
	);

	let loginPubkey: string | undefined = $state(getLoginPubkey());
	let isEnabledUseClientTag: boolean = $state(false);
	let deadRelays: string[] = $derived(getDeadRelays());
	let rc: RelayConnector | undefined = $derived(getRelayConnector());
	let sub: Subscription | undefined = $derived(getSubscription());
	let eventsProfile: NostrEvent[] = $state([]);
	const profileMap: Map<string, ProfileContentEvent> = $derived(
		new Map<string, ProfileContentEvent>(
			eventsProfile.map((ev) => {
				const pce: ProfileContentEvent = { event: ev, ...getProfileContent(ev) };
				return [ev.pubkey, pce];
			})
		)
	);
	let eventsTimeline: NostrEvent[] = $state([]);
	let eventsReaction: NostrEvent[] = $state([]);
	let eventFollowList: NostrEvent | undefined = $state();
	const followingPubkeys: string[] = $derived(
		eventFollowList?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ??
			[]
	);
	let eventMuteList: NostrEvent | undefined = $state();
	let eventRelayList: NostrEvent | undefined = $state();
	let eventMyPublicChatsList: NostrEvent | undefined = $state();
	let eventBlockedRelaysList: NostrEvent | undefined = $state();
	let eventEmojiSetList: NostrEvent | undefined = $state();
	let eventRead: NostrEvent | undefined = $state();
	let mutedPubkeys: string[] = $state([]);
	let mutedChannelIds: string[] = $state([]);
	let mutedWords: string[] = $state([]);
	let mutedHashtags: string[] = $state([]);
	const getMuteListPromise: Promise<[string[], string[], string[], string[]]> = $derived(
		getMuteList(eventMuteList, loginPubkey)
	);
	$effect(() => {
		getMuteListPromise.then((v: [string[], string[], string[], string[]]) => {
			[mutedPubkeys, mutedChannelIds, mutedWords, mutedHashtags] = v;
		});
	});
	let blockedRelays: string[] = $state([]);
	const getBlockedRelaysListPromise: Promise<string[]> = $derived(
		getBlockedRelaysList(eventBlockedRelaysList, loginPubkey)
	);
	$effect(() => {
		getBlockedRelaysListPromise.then((v: string[]) => {
			blockedRelays = v;
			rc?.setBlockedRelays(blockedRelays);
		});
	});
	let eventsBadge: NostrEvent[] = $state([]);
	let eventsPinList: NostrEvent[] = $state([]);
	let eventsPoll: NostrEvent[] = $state([]);
	let eventsEmojiSet: NostrEvent[] = $state([]);
	let eventsMention: NostrEvent[] = $state([]);
	const _getEventsFiltered = (events: NostrEvent[]) => {
		return getEventsFilteredByMute(
			events,
			mutedPubkeys,
			mutedChannelIds,
			mutedWords,
			mutedHashtags
		);
	};

	let lang: string = $state(initialLocale);
	let isEnabledDarkMode: boolean = $state(true);
	let isEnabledRelativeTime: boolean = $state(true);
	let isEnabledEventProtection: boolean = $state(false);
	let uploaderSelected: string = $state(uploaderURLs[0]);
	let kindsSelected: number[] = $state([]);
	let eventsChannel: NostrEvent[] = $state([]);
	let eventsChannelEdit: NostrEvent[] = $state([]);
	let eventsChannelBookmark: NostrEvent[] = $state([]);
	const channelMap: Map<string, ChannelContent> = $derived(
		getChannelMap(eventsChannel, eventsChannelEdit)
	);

	const setLang = (value: string): void => {
		lang = value;
		locale.set(value);
		saveLocalStorage();
	};
	const setIsEnabledDarkMode = (value: boolean): void => {
		isEnabledDarkMode = value;
		saveLocalStorage();
	};
	const setIsEnabledRelativeTime = (value: boolean): void => {
		isEnabledRelativeTime = value;
		saveLocalStorage();
	};
	const setIsEnabledUseClientTag = (value: boolean): void => {
		isEnabledUseClientTag = value;
		saveLocalStorage();
	};
	const setIsEnabledEventProtection = (value: boolean): void => {
		isEnabledEventProtection = value;
		saveLocalStorage();
	};
	const setUploaderSelected = (value: string): void => {
		uploaderSelected = value;
		saveLocalStorage();
	};
	const setKindsSelected = (value: number[]): void => {
		kindsSelected = value;
		rc?.setKindsBase(value);
		saveLocalStorage();
	};

	let urlSearchParams: URLSearchParams = $state(page.url.searchParams);
	let nowRealtime: number = $state(unixNow());
	let intervalID: number;

	const callback = (kind: number, event?: NostrEvent): void => {
		if (rc === undefined) {
			return;
		}
		let newEventsTimeline: NostrEvent[] | undefined;
		switch (kind) {
			case 0: {
				setNewEventsProfile();
				break;
			}
			case 1:
			case 6:
			case 16:
			case 20:
			case 40:
			case 42:
			case 1068:
			case 1111:
			case 20000:
			case 39701: {
				if (kind === 1068) {
					eventsPoll = sortEvents(rc.getEventsByFilter({ kinds: [1018, 1068] }));
				}
				const kinds: number[] = kindsSelected;
				let tl: NostrEvent[] = [];
				if (up.isAntenna && loginPubkey !== undefined) {
					const authors: string[] =
						rc
							.getReplaceableEvent(3, loginPubkey)
							?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p')
							.map((tag) => tag[1]) ?? [];
					if (authors.length > 0) {
						if (kindSet.size === 0) {
							tl = rc.getEventsByFilter({ kinds, authors });
						} else {
							tl = rc.getEventsByFilter({
								kinds: Array.from(kindSet),
								authors
							});
						}
					} else {
						tl = [];
					}
				} else if (up.currentEventPointer !== undefined) {
					tl = rc.getEventsByFilter({ ids: [up.currentEventPointer.id] });
				} else if (up.currentAddressPointer !== undefined) {
					const ap = up.currentAddressPointer;
					const filter: Filter = {
						kinds: [ap.kind],
						authors: [ap.pubkey]
					};
					if (isAddressableKind(ap.kind)) {
						filter['#d'] = [ap.identifier];
					}
					tl = rc.getEventsByFilter(filter);
				} else if (up.currentProfilePointer !== undefined) {
					if (kindSet.size === 0) {
						tl = rc.getEventsByFilter({ kinds, authors: [up.currentProfilePointer.pubkey] });
					} else {
						tl = rc.getEventsByFilter({
							kinds: Array.from(kindSet),
							authors: [up.currentProfilePointer.pubkey]
						});
					}
				} else if (up.currentChannelPointer !== undefined) {
					tl = rc
						.getEventsByFilter([
							{ kinds: [42], '#e': [up.currentChannelPointer.id] },
							{ kinds: [16], '#k': ['42'] }
						])
						.filter(
							(ev) =>
								ev.kind !== 16 ||
								rc
									?.getEventsByFilter({ ids: [getTagValue(ev, 'e') ?? ''] })
									.at(0)
									?.tags.some(
										(tag) =>
											tag[0] === 'e' && tag[1] === up.currentChannelPointer?.id && tag[3] === 'root'
									)
						);
				} else if (up.query !== undefined) {
					if (kindSet.size === 0) {
						tl = rc.getEventsByFilter([{ kinds: [42] }, { kinds: [16], '#k': ['42'] }]);
					} else {
						tl = rc.getEventsByFilter({ kinds: Array.from(kindSet) });
					}
					tl = tl.filter((ev) => ev.content.includes(up.query?.toLowerCase() ?? ''));
				} else if (up.hashtag !== undefined) {
					tl = rc.getEventsByFilter({ '#t': [up.hashtag.toLowerCase()] });
				} else if (up.category !== undefined) {
					tl = rc.getEventsByFilter({ kinds: [40, 41], '#t': [up.category.toLowerCase()] });
				} else {
					if (kindSet.size === 0) {
						tl = rc.getEventsByFilter([{ kinds: [42] }, { kinds: [16], '#k': ['42'] }]);
					} else {
						tl = rc.getEventsByFilter({ kinds: Array.from(kindSet) });
					}
				}
				if (kindSet.size > 0) {
					tl = tl.filter((ev) => kindSet.has(ev.kind));
				}
				if (pSet.size > 0) {
					tl = tl.filter((ev) => {
						const ps = ev.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 'p')
							.map((tag) => tag[1]);
						return ps.some((p) => pSet.has(p));
					});
				}
				if (dSet.size > 0) {
					tl = tl.filter((ev) => {
						const ds = ev.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 'd')
							.map((tag) => tag[1]);
						return ds.some((d) => dSet.has(d));
					});
				}
				if (gSet.size > 0) {
					tl = tl.filter((ev) => {
						const gs = ev.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 'g')
							.map((tag) => tag[1]);
						return gs.some((g) => gSet.has(g));
					});
				}
				if (authorSet.size > 0) {
					tl = tl.filter((ev) => authorSet.has(ev.pubkey));
				}
				if (relaySet.size > 0) {
					tl = tl.filter((ev) => rc?.getSeenOn(ev.id, false).some((r) => relaySet.has(r)));
				}
				const query = up.query;
				if (query !== undefined && query.length > 0) {
					tl = tl.filter((ev) => ev.content.includes(query));
				}
				if (up.date !== undefined) {
					const since = Math.floor(up.date.getTime() / 1000);
					const until = since + 24 * 60 * 60;
					tl = tl.filter((ev) => since <= ev.created_at && ev.created_at < until);
				}
				newEventsTimeline = sortEvents(tl);
				setNewEventsTimeline(newEventsTimeline, event);
				//TLに含まれるイベントのみ深くfetchする
				const idsInTimeline: Set<string> = new Set<string>(
					[...timelineSliced, ...eventsQuoted].map((ev) => ev.id)
				);
				if (
					event !== undefined &&
					idsInTimeline.has(event.id) &&
					[1, 6, 16, 42].includes(event.kind)
				) {
					rc.fetchNext(event, () => {}, true);
				}
				break;
			}
			case 3: {
				if (loginPubkey !== undefined && (event?.pubkey === loginPubkey || event === undefined)) {
					eventFollowList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 5: {
				if (event !== undefined) {
					const kSet: Set<number> = new Set<number>(
						event.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 'k' && /^\d+$/.test(tag[1]))
							.map((tag) => parseInt(tag[1]))
					);
					for (const k of kSet) {
						callback(k);
					}
				}
				break;
			}
			case 7: {
				setNewEventsReaction();
				break;
			}
			case 8:
			case 30008:
			case 30009: {
				eventsBadge = sortEvents(rc.getEventsByFilter({ kinds: [8, 30008, 30009] }));
				break;
			}
			case 40: {
				eventsChannel = rc.getEventsByFilter({ kinds: [kind] });
				break;
			}
			case 41: {
				eventsChannelEdit = rc.getEventsByFilter({ kinds: [kind] });
				break;
			}
			case 1018: {
				eventsPoll = sortEvents(rc.getEventsByFilter({ kinds: [1018, 1068] }));
				break;
			}
			case 10000: {
				if (loginPubkey !== undefined && (event?.pubkey === loginPubkey || event === undefined)) {
					eventMuteList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 10001: {
				eventsPinList = sortEvents(rc.getEventsByFilter({ kinds: [kind] }));
				break;
			}
			case 10002: {
				if (loginPubkey !== undefined && (event?.pubkey === loginPubkey || event === undefined)) {
					eventRelayList = rc.getReplaceableEvent(kind, loginPubkey);
					rc.setRelays(eventRelayList);
				}
				break;
			}
			case 10005: {
				eventsChannelBookmark = rc.getEventsByFilter({ kinds: [kind] });
				if (loginPubkey !== undefined && (event?.pubkey === loginPubkey || event === undefined)) {
					eventMyPublicChatsList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 10006: {
				if (loginPubkey !== undefined && (event?.pubkey === loginPubkey || event === undefined)) {
					eventBlockedRelaysList = rc.getReplaceableEvent(kind, loginPubkey);
				}
				break;
			}
			case 10030:
			case 30030: {
				if (loginPubkey !== undefined) {
					const ev10030 = rc.getReplaceableEvent(10030, loginPubkey);
					if (ev10030 !== undefined) {
						const aTags: string[][] = ev10030.tags.filter(
							(tag) => tag.length >= 2 && tag[0] === 'a'
						);
						const aps: nip19.AddressPointer[] = aTags.map((aTag) =>
							getAddressPointerFromATag(aTag)
						);
						const filters: Filter[] = mergeFilterForAddressableEvents(
							aps
								.filter((ap) => isAddressableKind(ap.kind))
								.map((ap) => {
									return { kinds: [ap.kind], authors: [ap.pubkey], '#d': [ap.identifier] };
								})
						);
						eventEmojiSetList = ev10030;
						eventsEmojiSet = getEventsAddressableLatest(
							rc.getEventsByFilter(filters).concat(ev10030)
						);
					}
				}
				break;
			}
			case 30078: {
				if (loginPubkey !== undefined) {
					eventRead = rc.getReplaceableEvent(30078, loginPubkey, 'nostter-read');
				}
				break;
			}
			default:
				break;
		}
		if (up.currentEventPointer !== undefined) {
			newEventsTimeline = rc.getEventsByFilter({ ids: [up.currentEventPointer.id] });
			setNewEventsTimeline(newEventsTimeline, event);
		} else if (up.currentAddressPointer !== undefined) {
			const ap = up.currentAddressPointer;
			const filter: Filter = {
				kinds: [ap.kind],
				authors: [ap.pubkey]
			};
			if (isAddressableKind(ap.kind)) {
				filter['#d'] = [ap.identifier];
			}
			newEventsTimeline = rc.getEventsByFilter(filter);
			setNewEventsTimeline(newEventsTimeline, event);
		} else if (
			(kindSet.size > 0 || pSet.size > 0 || dSet.size > 0 || gSet.size > 0) &&
			up.query === undefined
		) {
			const filter: Filter = { kinds: Array.from(kindSet) };
			if (up.currentProfilePointer !== undefined) {
				filter.authors = [up.currentProfilePointer.pubkey];
			} else if (up.isAntenna) {
				filter.authors = followingPubkeys;
			}
			let tl = sortEvents(rc.getEventsByFilter(filter));
			if (pSet.size > 0) {
				tl = tl.filter((ev) => {
					const ps = ev.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 'p')
						.map((tag) => tag[1]);
					return ps.some((p) => pSet.has(p));
				});
			}
			if (dSet.size > 0) {
				tl = tl.filter((ev) => {
					const ds = ev.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 'd')
						.map((tag) => tag[1]);
					return ds.some((d) => dSet.has(d));
				});
			}
			if (gSet.size > 0) {
				tl = tl.filter((ev) => {
					const gs = ev.tags
						.filter((tag) => tag.length >= 2 && tag[0] === 'g')
						.map((tag) => tag[1]);
					return gs.some((g) => gSet.has(g));
				});
			}
			if (relaySet.size > 0) {
				tl = tl.filter((ev) => rc?.getSeenOn(ev.id, false).some((r) => relaySet.has(r)));
			}
			newEventsTimeline = tl;
			setNewEventsTimeline(newEventsTimeline, event);
		} else if (isTopPage && followingPubkeys.length > 0) {
			let tl = (newEventsTimeline ?? eventsTimeline).filter((ev) =>
				followingPubkeys.includes(ev.pubkey)
			);
			if (relaySet.size > 0) {
				tl = tl.filter((ev) => rc?.getSeenOn(ev.id, false).some((r) => relaySet.has(r)));
			}
			newEventsTimeline = tl;
			setNewEventsTimeline(newEventsTimeline, event);
		}
		setEventsMension(kind, event);
	};

	const setEventsMension = (kind: number, event: NostrEvent | undefined): void => {
		if (rc === undefined) {
			return;
		}
		const kinds: number[] = [1, 4, 6, 7, 8, 16, 42, 1111, 9735, 39701];
		if (
			kinds.includes(kind) &&
			loginPubkey !== undefined &&
			(event?.tags.some((tag) => tag.length >= 2 && tag[0] === 'p' && tag[1] === loginPubkey) ||
				event === undefined)
		) {
			eventsMention = sortEvents(rc.getEventsByFilter({ kinds, '#p': [loginPubkey] }));
		}
	};

	let timerEventsTimeline: number | undefined;
	const eventsForFetchNext: NostrEvent[] = [];
	const setNewEventsTimeline = (events: NostrEvent[], event: NostrEvent | undefined) => {
		if (event !== undefined && !eventsForFetchNext.map((ev) => ev.id).includes(event.id)) {
			eventsForFetchNext.push(event);
		}
		clearTimeout(timerEventsTimeline);
		timerEventsTimeline = setTimeout(() => {
			eventsTimeline = events;
			//TLに含まれるイベントのみ深くfetchする
			const idsInTimeline: Set<string> = new Set<string>(
				[...timelineSliced, ...eventsQuoted].map((ev) => ev.id)
			);
			for (const event of eventsForFetchNext) {
				if (
					event !== undefined &&
					idsInTimeline.has(event.id) &&
					[1, 6, 16, 42].includes(event.kind)
				) {
					rc?.fetchNext(event, () => {}, true);
					if (
						kindSet.size > 0 ||
						up.currentAddressPointer !== undefined ||
						up.currentEventPointer !== undefined
					) {
						rc?.fetchUserProfile(event);
					}
				}
			}
			eventsForFetchNext.length = 0;
		}, 100);
	};
	let timerEventsProfile: number | undefined;
	const setNewEventsProfile = () => {
		clearTimeout(timerEventsProfile);
		timerEventsProfile = setTimeout(() => {
			if (rc === undefined) {
				return;
			}
			eventsProfile = getEventsAddressableLatest(rc.getEventsByFilter({ kinds: [0] })).filter(
				(ev) => isValidProfile(ev)
			);
		}, 100);
	};
	let timerEventsReaction: number | undefined;
	const setNewEventsReaction = () => {
		clearTimeout(timerEventsReaction);
		timerEventsReaction = setTimeout(() => {
			if (rc === undefined) {
				return;
			}
			eventsReaction = sortEvents(rc.getEventsByFilter({ kinds: [7] }));
			setEventsMension(7, undefined);
		}, 100);
	};

	const callbackConnectionState = (packet: ConnectionStatePacket) => {
		const relay: string = normalizeURL(packet.from);
		if (['error', 'rejected'].includes(packet.state)) {
			if (!deadRelays.includes(relay)) {
				deadRelays.push(relay);
				rc?.setDeadRelays(deadRelays);
				setDeadRelays(deadRelays);
			}
		} else {
			if (deadRelays.includes(relay)) {
				deadRelays = deadRelays.filter((r) => r !== relay);
				rc?.setDeadRelays(deadRelays);
				setDeadRelays(deadRelays);
			}
		}
	};

	const clearCache = () => {
		eventsProfile = [];
		eventsTimeline = [];
		eventsReaction = [];
		eventMuteList = undefined;
		eventRelayList = undefined;
		eventMyPublicChatsList = undefined;
		eventEmojiSetList = undefined;
		eventRead = undefined;
		eventsBadge = [];
		eventsPoll = [];
		eventsPinList = [];
		eventsEmojiSet = [];
		eventsMention = [];
	};

	const initStatus = () => {
		countToShow = 10;
		isScrolledBottom = false;
		isLoading = false;
		lastUntil = undefined;
	};

	const initFetch = () => {
		sub?.unsubscribe();
		initStatus();
		const pubkeySet = new Set<string>();
		if (rc === undefined) {
			clearCache();
			rc = new RelayConnector(loginPubkey !== undefined, callbackConnectionState);
			setRelayConnector(rc);
			rc.setKindsBase(kindsSelected);
			sub = rc.subscribeEventStore(callback);
			setSubscription(sub);
			if (loginPubkey !== undefined) {
				pubkeySet.add(loginPubkey);
			}
		} else {
			sub = rc.subscribeEventStore(callback);
			setSubscription(sub);
			//kind1は最後にしないと遅延セットしてるtimelineが虚無で上書きされてしまうので
			const kinds = [
				0, 3, 7, 8, 40, 41, 1018, 1068, 10000, 10001, 10002, 10005, 10006, 10030, 30078, 1
			];
			for (const k of kinds) {
				callback(k);
			}
		}
		const pubkey: string | undefined =
			up.currentProfilePointer?.pubkey ??
			up.currentAddressPointer?.pubkey ??
			up.currentEventPointer?.author;
		if (pubkey !== undefined) {
			pubkeySet.add(pubkey);
		}
		fetchKind10002AndFollowees(rc, loginPubkey, Array.from(pubkeySet));
	};

	const fetchKind10002AndFollowees = (
		rc: RelayConnector,
		loginPubkey: string | undefined,
		pubkeys: string[]
	) => {
		const fetchTimeline = (): void => {
			rc.fetchTimeline(
				up,
				urlSearchParams,
				loginPubkey,
				followingPubkeys,
				limit,
				undefined,
				() => {
					isLoading = false;
				},
				true
			);
		};
		isLoading = true;
		if (pubkeys.length > 0) {
			rc.fetchKind10002(pubkeys, () => {
				if (loginPubkey !== undefined && eventFollowList === undefined) {
					rc.fetchUserSettings(loginPubkey, () => {
						//ミュートリスト対象情報を取得
						rc.fetchMutedInfo(mutedChannelIds, mutedPubkeys, loginPubkey);
						//被メンションを取得
						rc.fetchEventsMention(loginPubkey, unixNow(), 10);
						//フォローイーのkind:10002を全取得
						const pubkeysSecond: string[] =
							eventFollowList?.tags
								.filter((tag) => tag.length >= 2 && tag[0] === 'p')
								.map((tag) => tag[1]) ?? [];
						if (pubkeysSecond.length > 0) {
							rc.fetchKind10002(pubkeysSecond, () => {
								fetchTimeline();
							});
						} else {
							fetchTimeline();
						}
					});
				} else {
					fetchTimeline();
				}
			});
		} else {
			fetchTimeline();
		}
	};

	const saveLocalStorage = () => {
		preferences.set({
			loginPubkey,
			lang,
			isEnabledDarkMode,
			isEnabledRelativeTime,
			isEnabledUseClientTag,
			isEnabledEventProtection,
			uploaderSelected,
			kindsSelected
		});
	};

	const nlAuth = (e: Event) => {
		let newLoginPubkey: string | undefined;
		const ce: CustomEvent = e as CustomEvent;
		if (ce.detail.type === 'login' || ce.detail.type === 'signup') {
			newLoginPubkey = ce.detail.pubkey;
		} else {
			newLoginPubkey = undefined;
		}
		if (loginPubkey === newLoginPubkey) {
			return;
		}
		loginPubkey = newLoginPubkey;
		setLoginPubkey(loginPubkey);
		saveLocalStorage();
		rc?.dispose();
		rc = undefined;
		setRelayConnector(rc);
		initFetch();
	};

	const kindSet: Set<number> = $derived.by(() => {
		const kindSet: Set<number> = new Set<number>();
		for (const [k, v] of urlSearchParams) {
			if (k === 'kind' && /^\d+$/.test(v)) {
				kindSet.add(parseInt(v));
			}
		}
		return kindSet;
	});
	const pSet: Set<string> = $derived.by(() => {
		const pSet: Set<string> = new Set<string>();
		for (const [k, v] of urlSearchParams) {
			if (k === 'p' && /^\w{64}$/.test(v)) {
				pSet.add(v);
			}
		}
		return pSet;
	});
	const dSet: Set<string> = $derived.by(() => {
		const dSet: Set<string> = new Set<string>();
		for (const [k, v] of urlSearchParams) {
			if (k === 'd') {
				dSet.add(v);
			}
		}
		return dSet;
	});
	const gSet: Set<string> = $derived.by(() => {
		const gSet: Set<string> = new Set<string>();
		for (const [k, v] of urlSearchParams) {
			if (k === 'g') {
				gSet.add(v);
			}
		}
		return gSet;
	});
	const authorSet: Set<string> = $derived.by(() => {
		const authorSet: Set<string> = new Set<string>();
		for (const [k, v] of urlSearchParams) {
			if (k === 'author') {
				authorSet.add(v);
			}
		}
		return authorSet;
	});
	const relaySet: Set<string> = $derived.by(() => {
		const relaySet: Set<string> = new Set<string>();
		for (const [k, v] of urlSearchParams) {
			if (k === 'relay' && URL.canParse(v)) {
				relaySet.add(normalizeURL(v));
			}
		}
		return relaySet;
	});
	const limit: number = 10;
	let countToShow: number = $state(limit);
	let countToShowMax: number = limit;
	const scopeCountToShow: number = 5 * limit;
	const timelineSliced: NostrEvent[] = $derived(
		eventsTimeline.slice(
			countToShow - scopeCountToShow > 0 ? countToShow - scopeCountToShow : 0,
			countToShow
		)
	);
	const eventsQuoted: NostrEvent[] = $derived(
		rc === undefined ? [] : rc.getQuotedEvents([...timelineSliced, ...eventsPinList], 5)
	);
	const isFullDisplayMode: boolean = $derived(
		up.currentAddressPointer !== undefined || up.currentEventPointer !== undefined
	);
	const scrollThreshold: number = 500;
	let isScrolledTop: boolean = false;
	let isScrolledBottom: boolean = false;
	let isLoading: boolean = $state(false);
	let lastUntil: number | undefined = undefined;
	const completeCustom = (): void => {
		console.info('[Loading Complete]');
		const correctionCount = Math.max(
			1,
			timelineSliced.filter((ev) => ev.created_at === lastUntil).length
		);
		const diff = limit + 1 - correctionCount;
		const lastChild = document.querySelector('.FeedList > .Entry:last-child');
		countToShow += diff; //unitlと同時刻のイベントは被って取得されるので補正
		countToShowMax = Math.max(countToShowMax, countToShow);
		setTimeout(() => {
			if (countToShow > scopeCountToShow) {
				lastChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
			}
			isLoading = false;
		}, 10);
		//新規にTLに表示されるイベントのみ深くfetchする
		for (const event of timelineSliced.slice(-1 * diff, -1)) {
			rc?.fetchNext(event, () => {}, true);
		}
	};

	const handlerScroll = (): void => {
		if (rc === undefined || isFullDisplayMode) {
			return;
		}
		const scrollHeight = Math.max(
			document.body.scrollHeight,
			document.documentElement.scrollHeight,
			document.body.offsetHeight,
			document.documentElement.offsetHeight,
			document.body.clientHeight,
			document.documentElement.clientHeight
		);
		const pageMostBottom = scrollHeight - window.innerHeight;
		const pageMostTop = 0;
		const scrollTop = window.scrollY || document.documentElement.scrollTop;
		if (scrollTop > pageMostBottom - scrollThreshold) {
			if (!isScrolledBottom && !isLoading) {
				isScrolledBottom = true;
				isLoading = true;
				//取得済のイベントは再取得しない
				if (countToShow + limit <= countToShowMax) {
					console.info('[Loading Start(not fetching)]');
					completeCustom();
					return;
				}
				const lastUntilNext: number | undefined = timelineSliced.at(-1)?.created_at;
				if (lastUntilNext === undefined || lastUntil === lastUntilNext) {
					return;
				}
				lastUntil = lastUntilNext;
				console.info('[Loading Start]');
				rc.fetchTimeline(
					up,
					urlSearchParams,
					loginPubkey,
					followingPubkeys,
					limit,
					lastUntil,
					completeCustom
				);
			}
		} else if (isScrolledBottom && scrollTop < pageMostBottom - scrollThreshold) {
			isScrolledBottom = false;
		}
		if (scrollTop < pageMostTop + scrollThreshold && countToShow > scopeCountToShow) {
			if (!isScrolledTop && !isLoading) {
				isScrolledTop = true;
				if (countToShow > scopeCountToShow) {
					const secondChild = document.querySelector('.FeedList > .Entry:nth-child(2)');
					countToShow = Math.max(countToShow - limit, scopeCountToShow);
					setTimeout(() => {
						secondChild?.scrollIntoView({ block: 'start', behavior: 'smooth' });
					}, 10);
				}
			}
		} else if (isScrolledTop && scrollTop > pageMostTop + scrollThreshold) {
			isScrolledTop = false;
		}
	};

	let unsubscriber: Unsubscriber | undefined;
	onMount(async () => {
		if (up.isError) {
			return;
		}
		if (document.querySelector('body > nl-banner') === null) {
			const { init } = await import('nostr-login');
			init({
				title: $_('App.nostr-login.title'),
				description: $_('App.nostr-login.description')
			});
		}
		if (!document.querySelector('body > div:last-child')?.shadowRoot?.querySelector('style')) {
			// @ts-expect-error 型なんて定義されてないよ
			const { injectCSS } = await import('nostr-zap/src/view');
			injectCSS();
		}
	});
	beforeNavigate(() => {
		if (unsubscriber !== undefined) {
			unsubscriber();
		}
		clearInterval(intervalID);
		document.removeEventListener('nlAuth', nlAuth);
		document.removeEventListener('scroll', handlerScroll);
	});
	afterNavigate(() => {
		unsubscriber = preferences.subscribe(
			(value: {
				loginPubkey: string | undefined;
				lang: string | undefined;
				isEnabledDarkMode: boolean | undefined;
				isEnabledRelativeTime: boolean | undefined;
				isEnabledUseClientTag: boolean | undefined;
				isEnabledEventProtection: boolean | undefined;
				uploaderSelected: string | undefined;
				kindsSelected: number[] | undefined;
			}) => {
				loginPubkey = value.loginPubkey;
				setLoginPubkey(loginPubkey);
				lang = value.lang ?? initialLocale;
				isEnabledDarkMode = value.isEnabledDarkMode ?? true;
				isEnabledRelativeTime = value.isEnabledRelativeTime ?? true;
				isEnabledUseClientTag = value.isEnabledUseClientTag ?? false;
				isEnabledEventProtection = value.isEnabledEventProtection ?? false;
				uploaderSelected = value.uploaderSelected ?? uploaderURLs[0];
				kindsSelected = value.kindsSelected ?? defaultKindsSelected;
			}
		);
		if (up.isError) {
			return;
		}
		urlSearchParams = page.url.searchParams;
		document.addEventListener('nlAuth', nlAuth);
		document.addEventListener('scroll', handlerScroll);
		//+page.svelte で up がセットされてから実行する
		setTimeout(async () => {
			locale.set(lang ?? 'en');
			const sleep = (timeout: number) => new Promise((handler) => setTimeout(handler, timeout));
			while (up.isNIP05Fetching) {
				console.info('[NIP05 fetching...]');
				await sleep(100);
			}
			initFetch();
		}, 10);
		intervalID = setInterval(() => {
			nowRealtime = unixNow();
		}, 5000);
	});

	const title: string = $derived.by(() => {
		let title: string | undefined;
		if (up.isSettings) {
			title = $_('App.title.settings');
		} else if (up.query !== undefined) {
			title = $_('App.title.search');
		} else if (up.isAntenna) {
			title = $_('App.title.antenna');
		} else if (up.currentEventPointer !== undefined || up.currentAddressPointer !== undefined) {
			title = $_('App.title.entry');
		} else if (up.currentProfilePointer !== undefined) {
			const prof = profileMap.get(up.currentProfilePointer.pubkey);
			title = `${prof?.display_name ?? ''} (id:${prof?.name ?? `${up.currentProfilePointer.pubkey.slice(0, 15)}...`})`;
		} else if (up.currentChannelPointer !== undefined) {
			const channel = channelMap.get(up.currentChannelPointer.id);
			title = channel?.name ?? 'unknown channel';
		} else if (up.hashtag !== undefined) {
			title = `#${up.hashtag}`;
		} else if (up.category !== undefined) {
			title = `#${up.category}`;
		} else if (up.isError) {
			title = $_('App.title.home');
		} else if (page.url.pathname === '/') {
			title = $_('App.title.home');
		}
		return title !== undefined ? `${title} / Nos Haiku` : 'Nos Haiku';
	});
</script>

<svelte:head>
	<meta property="og:title" content="Nos Haiku" />
	<meta property="og:type" content="website" />
	<meta property="og:image" content={`${page.url.origin}/ogp.png`} />
	<meta property="og:url" content={page.url.href} />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon.png" />
	<link rel="manifest" href="/manifest.json" />
	<title>{title}</title>
</svelte:head>

<div id="app" class={loginPubkey !== undefined && isEnabledDarkMode ? 'dark' : 'light'}>
	{#if up.isError}
		<Header
			{rc}
			{loginPubkey}
			{eventsMention}
			{eventFollowList}
			readTimeOfNotification={eventRead?.created_at ?? 0}
			currentProfilePointer={up.currentProfilePointer}
			query={up.query}
			{urlSearchParams}
			{profileMap}
			{mutedPubkeys}
			{mutedWords}
			{mutedHashtags}
			{isEnabledRelativeTime}
			{nowRealtime}
			isEnabledScrollInfinitely={false}
		/>
		<main class="SearchView View">
			<div class="Layout">
				<div class="Column Column--main">
					<div class="Feed">
						<div class="Feed__head">
							<div class="Feed__info">
								<h1 class="Feed__title">{page.status} {page.error?.message ?? ''}</h1>
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>
	{:else if up.isSettings === true}
		<Settings
			{rc}
			{loginPubkey}
			{eventsMention}
			{eventFollowList}
			readTimeOfNotification={eventRead?.created_at ?? 0}
			query={up.query}
			{urlSearchParams}
			{lang}
			{setLang}
			{isEnabledDarkMode}
			{setIsEnabledDarkMode}
			{isEnabledRelativeTime}
			{setIsEnabledRelativeTime}
			{isEnabledUseClientTag}
			{setIsEnabledUseClientTag}
			{isEnabledEventProtection}
			{setIsEnabledEventProtection}
			{eventMuteList}
			{eventRelayList}
			{uploaderSelected}
			{setUploaderSelected}
			{kindsSelected}
			{setKindsSelected}
			{eventsBadge}
			{eventsPoll}
			{eventsQuoted}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedChannelIds}
			{mutedWords}
			{mutedHashtags}
			{followingPubkeys}
			{nowRealtime}
		/>
	{:else if up.query !== undefined && Array.from(urlSearchParams.entries()).every(([k, v]) => k === 'kind' && /^\d+$/.test(v) && [40, 41].includes(parseInt(v)))}
		<Search
			{rc}
			{loginPubkey}
			{eventsMention}
			{eventFollowList}
			readTimeOfNotification={eventRead?.created_at ?? 0}
			currentProfilePointer={up.currentProfilePointer}
			query={up.query}
			{urlSearchParams}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedWords}
			{mutedHashtags}
			{isEnabledRelativeTime}
			{nowRealtime}
		/>
	{:else}
		<Page
			{rc}
			{loginPubkey}
			{eventsMention}
			readTimeOfNotification={eventRead?.created_at ?? 0}
			eventsTimeline={timelineSliced}
			{eventsQuoted}
			{eventsReaction}
			{eventsChannelBookmark}
			{eventsBadge}
			{eventsPoll}
			{eventsPinList}
			{eventsEmojiSet}
			{eventFollowList}
			{eventMuteList}
			{eventMyPublicChatsList}
			{eventEmojiSetList}
			isAntenna={up.isAntenna}
			currentProfilePointer={up.currentProfilePointer}
			currentChannelPointer={up.currentChannelPointer}
			currentEventPointer={up.currentEventPointer}
			currentAddressPointer={up.currentAddressPointer}
			query={up.query}
			{urlSearchParams}
			hashtag={up.hashtag}
			category={up.category}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedChannelIds}
			{mutedWords}
			{mutedHashtags}
			{followingPubkeys}
			{uploaderSelected}
			{isEnabledEventProtection}
			{isEnabledUseClientTag}
			{isEnabledRelativeTime}
			{nowRealtime}
			{isLoading}
		/>
	{/if}
</div>
