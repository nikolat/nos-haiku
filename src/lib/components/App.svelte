<script lang="ts">
	import type { ChannelContent, ProfileContentEvent, UrlParams } from '$lib/utils';
	import {
		clearCache,
		getChannelMap,
		getEventsFirst,
		getFollowList,
		getIsEnabledDarkMode,
		getIsEnabledRelativeTime,
		getIsEnabledSkipKind1,
		getIsEnabledUseClientTag,
		getLang,
		getLoginPubkey,
		getMutedChannelIds,
		getMutedHashTags,
		getMutedPubkeys,
		getMutedWords,
		getProfileMap,
		getRelaysSelected,
		getUploaderSelected,
		resetRelaysDefault,
		setLoginPubkey
	} from '$lib/resource.svelte';
	import Settings from '$lib/components/Settings.svelte';
	import Search from '$lib/components/Search.svelte';
	import Page from '$lib/components/Page.svelte';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { unixNow } from 'applesauce-core/helpers';
	import '$lib/haiku.css';
	import { _, locale } from 'svelte-i18n';

	const urlParams: UrlParams = $props();
	const {
		currentPubkey,
		currentChannelId,
		currentNoteId,
		currentAddressPointer,
		hashtag,
		category,
		query,
		isSettings,
		isAntenna
	}: UrlParams = $derived(urlParams);
	const loginPubkey: string | undefined = $derived(getLoginPubkey());
	const lang: string = $derived(getLang());
	const isEnabledDarkMode: boolean = $derived(getIsEnabledDarkMode());
	const isEnabledRelativeTime: boolean = $derived(getIsEnabledRelativeTime());
	const isEnabledSkipKind1: boolean = $derived(getIsEnabledSkipKind1());
	const isEnabledUseClientTag: boolean = $derived(getIsEnabledUseClientTag());
	const relaysSelected: string = $derived(getRelaysSelected());
	const uploaderSelected: string = $derived(getUploaderSelected());
	const profileMap: Map<string, ProfileContentEvent> = $derived(getProfileMap());
	const channelMap: Map<string, ChannelContent> = $derived(getChannelMap());
	const mutedPubkeys: string[] = $derived(getMutedPubkeys());
	const mutedChannelIds: string[] = $derived(getMutedChannelIds());
	const mutedWords: string[] = $derived(getMutedWords());
	const mutedHashTags: string[] = $derived(getMutedHashTags());
	const eventFollowList: NostrEvent | undefined = $derived(getFollowList());
	const followingPubkeys: string[] = $derived(
		eventFollowList?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ??
			[]
	);

	let urlSearchParams: URLSearchParams = $state(page.url.searchParams);
	let isLoading: boolean = $state(false);
	let idTimeout: number;
	let nowRealtime: number = $state(1000 * unixNow());
	let intervalID: number;
	const getEventsFirstWithLoading = () => {
		isLoading = true;
		getEventsFirst(
			{ ...urlParams, urlSearchParams },
			undefined,
			() => {
				isLoading = false;
			},
			true
		);
	};
	onMount(async () => {
		locale.set(lang);
		document.addEventListener('nlAuth', (e) => {
			clearTimeout(idTimeout);
			const ce: CustomEvent = e as CustomEvent;
			if (ce.detail.type === 'login' || ce.detail.type === 'signup') {
				setLoginPubkey(ce.detail.pubkey);
				getEventsFirstWithLoading();
			} else {
				setLoginPubkey(undefined);
				clearCache([{ until: unixNow() }]);
				resetRelaysDefault();
				getEventsFirstWithLoading();
			}
		});
		const { init } = await import('nostr-login');
		init({});
		// @ts-expect-error 型なんて定義されてないよ
		const { injectCSS } = await import('nostr-zap/src/view');
		injectCSS();
	});
	beforeNavigate(() => {
		clearInterval(intervalID);
	});
	afterNavigate(() => {
		idTimeout = setTimeout(getEventsFirstWithLoading, loginPubkey === undefined ? 1000 : 10);
		intervalID = setInterval(() => {
			nowRealtime = 1000 * unixNow();
		}, 5000);
		urlSearchParams = page.url.searchParams;
	});

	const title: string = $derived.by(() => {
		let title: string | undefined;
		if (isSettings) {
			title = $_('App.title.settings');
		} else if (query !== undefined) {
			title = 'お題を探す';
		} else if (isAntenna) {
			title = 'アンテナ';
		} else if (currentNoteId !== undefined || currentAddressPointer !== undefined) {
			title = 'Entry';
		} else if (currentPubkey !== undefined) {
			const prof = profileMap.get(currentPubkey);
			title = `${prof?.display_name ?? ''} (id:${prof?.name ?? `${currentPubkey.slice(0, 15)}...`})`;
		} else if (currentChannelId !== undefined) {
			const channel = channelMap.get(currentChannelId);
			title = channel?.name ?? 'unknown channel';
		} else if (hashtag !== undefined) {
			title = `#${hashtag}`;
		} else if (category !== undefined) {
			title = `#${category}`;
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
	{#if isSettings === true}
		<Settings
			{loginPubkey}
			{query}
			{urlSearchParams}
			{lang}
			{isEnabledDarkMode}
			{isEnabledRelativeTime}
			{isEnabledSkipKind1}
			{isEnabledUseClientTag}
			{relaysSelected}
			{uploaderSelected}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedChannelIds}
			{mutedWords}
			{mutedHashTags}
			{followingPubkeys}
			{nowRealtime}
		/>
	{:else if query !== undefined && urlSearchParams
			.entries()
			.every(([k, v]) => k === 'kind' && /^\d+$/.test(v) && [40, 41].includes(parseInt(v)))}
		<Search
			{loginPubkey}
			{query}
			{urlSearchParams}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedWords}
			{mutedHashTags}
			{isEnabledRelativeTime}
			{nowRealtime}
		/>
	{:else}
		<Page
			{loginPubkey}
			{isAntenna}
			{currentPubkey}
			{currentChannelId}
			{currentNoteId}
			{currentAddressPointer}
			{query}
			{urlSearchParams}
			{hashtag}
			{category}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedChannelIds}
			{mutedWords}
			{mutedHashTags}
			{followingPubkeys}
			{uploaderSelected}
			{isEnabledRelativeTime}
			{nowRealtime}
			bind:isLoading
		/>
	{/if}
</div>
