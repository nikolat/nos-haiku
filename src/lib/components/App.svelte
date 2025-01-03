<script lang="ts">
	import type { ChannelContent, ProfileContentEvent, UrlParams } from '$lib/utils';
	import {
		clearCache,
		getChannelMap,
		getEventsFirst,
		getFollowList,
		getIsEnabledDarkMode,
		getIsEnabledSkipKind1,
		getIsEnabledUseClientTag,
		getMutedChannelIds,
		getMutedPubkeys,
		getMutedWords,
		getLoginPubkey,
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
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { unixNow } from 'applesauce-core/helpers';
	import '$lib/haiku.css';

	const urlParams: UrlParams = $props();
	const {
		currentPubkey,
		currentChannelId,
		currentNoteId,
		hashtag,
		query,
		isSettings,
		isAntenna
	}: UrlParams = $derived(urlParams);
	const loginPubkey: string | undefined = $derived(getLoginPubkey());
	const isEnabledDarkMode: boolean = $derived(getIsEnabledDarkMode());
	const isEnabledSkipKind1: boolean = $derived(getIsEnabledSkipKind1());
	const isEnabledUseClientTag: boolean = $derived(getIsEnabledUseClientTag());
	const relaysSelected: string = $derived(getRelaysSelected());
	const uploaderSelected: string = $derived(getUploaderSelected());
	const profileMap: Map<string, ProfileContentEvent> = $derived(getProfileMap());
	const channelMap: Map<string, ChannelContent> = $derived(getChannelMap());
	const mutedPubkeys: string[] = $derived(getMutedPubkeys());
	const mutedChannelIds: string[] = $derived(getMutedChannelIds());
	const mutedWords: string[] = $derived(getMutedWords());
	const eventFollowList: NostrEvent | undefined = $derived(getFollowList());
	const followingPubkeys: string[] = $derived(
		eventFollowList?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ??
			[]
	);

	let idTimeout: number;
	let nowRealtime: number = $state(1000 * unixNow());
	let intervalID: number;
	onMount(async () => {
		document.addEventListener('nlAuth', (e) => {
			clearTimeout(idTimeout);
			const ce: CustomEvent = e as CustomEvent;
			if (ce.detail.type === 'login' || ce.detail.type === 'signup') {
				setLoginPubkey(ce.detail.pubkey);
				goto(location.href);
			} else {
				setLoginPubkey(undefined);
				clearCache();
				resetRelaysDefault();
				goto(location.href);
			}
		});
		const { init } = await import('nostr-login');
		init({});
		// @ts-expect-error 型なんて定義されてないよ
		const { injectCSS, initTargets } = await import('nostr-zap/src/view');
		injectCSS();
		initTargets();
	});
	beforeNavigate(() => {
		clearInterval(intervalID);
	});
	afterNavigate(() => {
		idTimeout = setTimeout(() => {
			getEventsFirst(urlParams);
		}, 1000);
		intervalID = setInterval(() => {
			nowRealtime = 1000 * unixNow();
		}, 5000);
	});

	const title: string = $derived.by(() => {
		let title: string | undefined;
		if (isSettings) {
			title = '設定';
		} else if (query !== undefined) {
			title = 'お題を探す';
		} else if (isAntenna) {
			title = 'アンテナ';
		} else if (currentNoteId !== undefined) {
			title = 'Entry';
		} else if (currentPubkey !== undefined) {
			const prof = profileMap.get(currentPubkey);
			title = `${prof?.display_name ?? ''} (id:${prof?.name ?? `${currentPubkey.slice(0, 15)}...`})`;
		} else if (currentChannelId !== undefined) {
			const channel = channelMap.get(currentChannelId);
			title = channel?.name ?? 'unknown channel';
		} else if (hashtag !== undefined) {
			title = `#${hashtag}`;
		} else if (page.url.pathname === '/') {
			title = 'ホーム';
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
			{isEnabledDarkMode}
			{isEnabledSkipKind1}
			{isEnabledUseClientTag}
			{relaysSelected}
			{uploaderSelected}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedChannelIds}
			{mutedWords}
			{followingPubkeys}
			{nowRealtime}
		/>
	{:else if query !== undefined}
		<Search {loginPubkey} {query} {profileMap} {channelMap} {mutedPubkeys} {nowRealtime} />
	{:else}
		<Page
			{loginPubkey}
			{isAntenna}
			{currentPubkey}
			{currentChannelId}
			{currentNoteId}
			{hashtag}
			{profileMap}
			{channelMap}
			{mutedPubkeys}
			{mutedChannelIds}
			{mutedWords}
			{followingPubkeys}
			{uploaderSelected}
			{nowRealtime}
		/>
	{/if}
</div>
