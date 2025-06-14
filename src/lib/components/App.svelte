<script lang="ts">
	import type { ChannelContent, ProfileContentEvent, UrlParams } from '$lib/utils';
	import { initialLocale } from '$lib/config';
	import {
		clearCache,
		getChannelMap,
		getEventsFirst,
		getFollowList,
		getIsEnabledDarkMode,
		getIsEnabledEventProtection,
		getIsEnabledOutboxModel,
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
		setLoginPubkey,
		setRxNostr
	} from '$lib/resource.svelte';
	import Header from '$lib/components/Header.svelte';
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

	const {
		up
	}: {
		up: UrlParams;
	} = $props();
	const {
		currentProfilePointer,
		currentChannelPointer,
		currentEventPointer,
		currentAddressPointer,
		hashtag,
		category,
		query,
		isSettings,
		isAntenna,
		isError
	}: UrlParams = $derived(up);
	const loginPubkey: string | undefined = $derived(getLoginPubkey());
	const lang: string = $derived(getLang());
	const isEnabledDarkMode: boolean = $derived(getIsEnabledDarkMode());
	const isEnabledRelativeTime: boolean = $derived(getIsEnabledRelativeTime());
	const isEnabledSkipKind1: boolean = $derived(getIsEnabledSkipKind1());
	const isEnabledUseClientTag: boolean = $derived(getIsEnabledUseClientTag());
	const isEnabledOutboxModel: boolean = $derived(getIsEnabledOutboxModel());
	const isEnabledEventProtection: boolean = $derived(getIsEnabledEventProtection());
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
	let idTimeoutLoading: number;
	let nowRealtime: number = $state(unixNow());
	let intervalID: number;
	const getEventsFirstWithLoading = () => {
		isLoading = true;
		setRxNostr(loginPubkey !== undefined);
		getEventsFirst(
			{ ...up, urlSearchParams },
			undefined,
			() => {
				isLoading = false;
			},
			true
		);
	};
	const nlAuth = (e: Event) => {
		clearTimeout(idTimeoutLoading);
		const ce: CustomEvent = e as CustomEvent;
		//何故か2回呼ばれる
		if (isLoading) {
			return;
		}
		if (ce.detail.type === 'login' || ce.detail.type === 'signup') {
			setLoginPubkey(ce.detail.pubkey);
			getEventsFirstWithLoading();
		} else {
			setLoginPubkey(undefined);
			clearCache([{ since: 0 }]);
			resetRelaysDefault();
			getEventsFirstWithLoading();
		}
	};
	onMount(async () => {
		locale.set(lang ?? initialLocale);
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
		clearInterval(intervalID);
		document.removeEventListener('nlAuth', nlAuth);
	});
	afterNavigate(() => {
		document.addEventListener('nlAuth', nlAuth);
		idTimeoutLoading = setTimeout(getEventsFirstWithLoading, 100);
		intervalID = setInterval(() => {
			nowRealtime = unixNow();
		}, 5000);
		urlSearchParams = page.url.searchParams;
	});

	const title: string = $derived.by(() => {
		let title: string | undefined;
		if (isSettings) {
			title = $_('App.title.settings');
		} else if (query !== undefined) {
			title = $_('App.title.search');
		} else if (isAntenna) {
			title = $_('App.title.antenna');
		} else if (currentEventPointer !== undefined || currentAddressPointer !== undefined) {
			title = $_('App.title.entry');
		} else if (currentProfilePointer !== undefined) {
			const prof = profileMap.get(currentProfilePointer.pubkey);
			title = `${prof?.display_name ?? ''} (id:${prof?.name ?? `${currentProfilePointer.pubkey.slice(0, 15)}...`})`;
		} else if (currentChannelPointer !== undefined) {
			const channel = channelMap.get(currentChannelPointer.id);
			title = channel?.name ?? 'unknown channel';
		} else if (hashtag !== undefined) {
			title = `#${hashtag}`;
		} else if (category !== undefined) {
			title = `#${category}`;
		} else if (isError) {
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
	{#if isError}
		<Header
			{loginPubkey}
			{currentProfilePointer}
			{query}
			{urlSearchParams}
			{profileMap}
			{mutedPubkeys}
			{mutedWords}
			{mutedHashTags}
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
	{:else if isSettings === true}
		<Settings
			{loginPubkey}
			{query}
			{urlSearchParams}
			{lang}
			{isEnabledDarkMode}
			{isEnabledRelativeTime}
			{isEnabledSkipKind1}
			{isEnabledUseClientTag}
			{isEnabledOutboxModel}
			{isEnabledEventProtection}
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
	{:else if query !== undefined && Array.from(urlSearchParams.entries()).every(([k, v]) => k === 'kind' && /^\d+$/.test(v) && [40, 41].includes(parseInt(v)))}
		<Search
			{loginPubkey}
			{currentProfilePointer}
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
			{currentProfilePointer}
			{currentChannelPointer}
			{currentEventPointer}
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
