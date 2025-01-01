<script lang="ts">
	import {
		getRoboHashURL,
		serviceLogoImageUri,
		zapImageUri,
		zapNpub,
		zapRelays
	} from '$lib/config';
	import type { ChannelContent, ProfileContentEvent, UrlParams } from '$lib/utils';
	import {
		bookmarkChannel,
		followUser,
		getChannelBookmarkMap,
		getEventById,
		getEventsFirst,
		getEventsReaction,
		getEventsTimelineTop,
		getProfileEventMap,
		getProfileName,
		muteChannel,
		muteUser,
		unbookmarkChannel,
		unfollowUser,
		unmuteChannel,
		unmuteUser
	} from '$lib/resource.svelte';
	import Header from '$lib/components/Header.svelte';
	import Profile from '$lib/components/Profile.svelte';
	import Content from '$lib/components/Content.svelte';
	import CreateEntry from '$lib/components/CreateEntry.svelte';
	import Entry from '$lib/components/Entry.svelte';
	import ChannelMeta from '$lib/components/ChannelMeta.svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import { unixNow } from 'applesauce-core/helpers';

	const {
		loginPubkey,
		isAntenna,
		currentPubkey,
		currentChannelId,
		currentNoteId,
		hashtag,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		followingPubkeys,
		uploaderSelected,
		nowRealtime
	}: {
		loginPubkey: string | undefined;
		isAntenna: boolean | undefined;
		currentPubkey: string | undefined;
		currentChannelId: string | undefined;
		currentNoteId: string | undefined;
		hashtag: string | undefined;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		followingPubkeys: string[];
		uploaderSelected: string;
		nowRealtime: number;
	} = $props();
	const eventsTimeline: NostrEvent[] = $derived(getEventsTimelineTop());
	const profileEventMap: Map<string, NostrEvent> = $derived(getProfileEventMap());
	const channelBookmarkMap: Map<string, string[]> = $derived(getChannelBookmarkMap());
	const followingChannelIds: string[] = $derived(channelBookmarkMap.get(loginPubkey ?? '') ?? []);
	const channelIds: string[] = $derived(
		Array.from(
			new Set<string>(
				eventsTimeline
					.filter((ev) => ev.kind === 42)
					.map((ev) =>
						ev.tags.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')?.at(1)
					)
					.filter((id) => id !== undefined)
					.filter(
						(id) =>
							!mutedChannelIds.includes(id) && !mutedWords.includes(channelMap.get(id)?.name ?? '')
					)
			)
		)
	);
	const profilePubkeysActive: string[] = $derived(
		Array.from(
			new Set<string>(
				eventsTimeline
					.filter((ev) => {
						if (currentChannelId !== undefined) {
							return (
								ev.kind === 42 &&
								ev.tags.some(
									(tag) =>
										tag.length >= 4 &&
										tag[0] === 'e' &&
										tag[1] === currentChannelId &&
										tag[3] === 'root'
								)
							);
						} else if (hashtag !== undefined) {
							return ev.tags.some((tag) => tag.length >= 2 && tag[0] === 't' && tag[1] === hashtag);
						} else {
							return true;
						}
					})
					.map((ev) => ev.pubkey)
			)
		).filter((pubkey) => !mutedPubkeys.includes(pubkey))
	);
	const eventsReaction: NostrEvent[] = $derived(getEventsReaction());

	let countToShow: number = $state(10);

	const timelineAll: NostrEvent[] = $derived.by(() => {
		let tl: NostrEvent[];
		if (isAntenna) {
			tl = eventsTimeline.filter((ev) => followingPubkeys.includes(ev.pubkey));
		} else if (currentNoteId !== undefined) {
			const entry = getEventById(currentNoteId);
			tl = entry !== undefined ? [entry] : [];
		} else if (currentPubkey !== undefined) {
			tl = eventsTimeline.filter((ev) => ev.pubkey === currentPubkey);
		} else if (currentChannelId !== undefined) {
			tl = eventsTimeline.filter(
				(ev) =>
					(ev.kind === 42 &&
						ev.tags.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')?.at(1) ===
							currentChannelId) ||
					(ev.kind === 16 &&
						ev.tags.some((tag) => tag.length >= 2 && tag[0] === 'k' && tag[1] === '42') &&
						getEventById(ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1) ?? '')
							?.tags.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
							?.at(1) === currentChannelId)
			);
		} else if (hashtag !== undefined) {
			tl = eventsTimeline.filter((ev) =>
				ev.tags.some(
					(tag) =>
						tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag.toLowerCase()
				)
			);
		} else {
			tl = eventsTimeline.filter(
				(ev) =>
					ev.kind === 42 ||
					(ev.kind === 16 &&
						ev.tags.some((tag) => tag.length >= 2 && tag[0] === 'k' && tag[1].includes('42')))
			);
		}
		return tl;
	});
	const timelineSliced = $derived(timelineAll.slice(0, countToShow));
	const timelineToShow: NostrEvent[] = $derived(
		timelineSliced.filter((ev) => {
			const rootId = ev.tags
				.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
				?.at(1);
			return (
				!(currentPubkey === undefined && mutedPubkeys.includes(ev.pubkey)) &&
				!(currentChannelId === undefined && mutedChannelIds.includes(rootId ?? '')) &&
				!mutedWords.some(
					(word) =>
						ev.content.includes(word) ||
						(ev.kind === 42 && (channelMap.get(rootId ?? '')?.name ?? '').includes(word))
				) &&
				!(ev.kind === 42 && rootId === undefined)
			);
		})
	);

	let isScrolledBottom = false;
	let isLoading = false;
	const scrollThreshold = 300;

	const urlParams: UrlParams = $derived({
		currentPubkey,
		currentChannelId,
		currentNoteId,
		isAntenna
	});

	const handlerScroll = () => {
		const scrollHeight = Math.max(
			document.body.scrollHeight,
			document.documentElement.scrollHeight,
			document.body.offsetHeight,
			document.documentElement.offsetHeight,
			document.body.clientHeight,
			document.documentElement.clientHeight
		);
		const pageMostBottom = scrollHeight - window.innerHeight;
		const scrollTop = window.scrollY || document.documentElement.scrollTop;
		if (scrollTop > pageMostBottom - scrollThreshold) {
			if (!isScrolledBottom && !isLoading) {
				console.log('[Loading Start]');
				isScrolledBottom = true;
				isLoading = true;
				const until: number = timelineSliced.at(-1)?.created_at ?? unixNow();
				const correctionCount: number = $state.snapshot(
					timelineSliced.filter((ev) => ev.created_at === until).length
				);
				getEventsFirst(
					urlParams,
					until,
					() => {
						console.log('[Loading Complete]');
						countToShow += 10 - correctionCount; //unitlと同時刻のイベントは被って取得されるので補正
						isLoading = false;
					},
					false
				);
			}
		} else if (isScrolledBottom && scrollTop < pageMostBottom + scrollThreshold) {
			isScrolledBottom = false;
		}
	};

	let showSetting: boolean = $state(false);
	const handlerSetting = (ev: MouseEvent): void => {
		const target: HTMLElement | null = ev.target as HTMLElement | null;
		if (!target?.closest('.SettingButton')) {
			showSetting = false;
		}
	};

	beforeNavigate(() => {
		document.removeEventListener('click', handlerSetting);
		document.removeEventListener('scroll', handlerScroll);
		countToShow = 10;
	});
	afterNavigate(() => {
		document.addEventListener('click', handlerSetting);
		document.addEventListener('scroll', handlerScroll);
		const correctionCount: number = $state.snapshot(
			timelineSliced.filter((ev) => ev.created_at === timelineSliced.at(-1)?.created_at).length
		);
		countToShow = 10 - correctionCount;
	});
</script>

<Header {loginPubkey} {profileMap} {mutedPubkeys} {nowRealtime} />
<main class="Homepage View">
	<div class="Layout">
		<div class="Column Column--left Column--nomobile">
			<div class="Card">
				<div class="Card__head">
					<h3 class="Card__title"><i class="fa-fw fas fa-users"></i>ユーザー一覧</h3>
				</div>
				<div class="Card__body">
					{#if currentPubkey === undefined}
						<div class="UserList UserList--grid">
							{#each profilePubkeysActive as pubkey (pubkey)}
								{@const prof = profileMap.get(pubkey)}
								<div class="UserList__user">
									<a href="/{nip19.npubEncode(pubkey)}">
										<img
											src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(pubkey))}
											alt={getProfileName(prof)}
											title={getProfileName(prof)}
											class="Avatar"
										/>
									</a>
								</div>
							{/each}
						</div>
					{:else}
						<Profile
							{loginPubkey}
							{currentPubkey}
							{profileMap}
							{profileEventMap}
							{channelMap}
							{eventsTimeline}
							{eventsReaction}
							{mutedPubkeys}
							{mutedChannelIds}
							{mutedWords}
							{followingPubkeys}
						/>
					{/if}
				</div>
			</div>
		</div>
		<div class="Column Column--main">
			<div class="Feed">
				<div class="Feed__head">
					<div class="Feed__info">
						{#if isAntenna}
							<h1 class="Feed__title"><i class="fa-fw fas fa-broadcast-tower"></i> アンテナ</h1>
							<h3 class="Feed__subtitle">お気に入りの人たちとキーワード</h3>
						{:else if currentNoteId !== undefined}
							{#if currentPubkey !== undefined}
								{@const profile = profileMap.get(currentPubkey)}
								<h1 class="Feed__title">
									<Content
										content={getProfileName(profile)}
										tags={profile?.event.tags ?? []}
										isAbout={true}
									/>
									さんのエントリー
								</h1>
							{:else}
								<h1 class="Feed__title">エントリー</h1>
							{/if}
						{:else if currentPubkey !== undefined}
							{@const profile = profileMap.get(currentPubkey)}
							{@const idView = `id:${profile?.name ?? 'none'}`}
							<h1 class="Feed__title">
								<i class="fa-fw fas fa-book-user"></i>
								<Content
									content={getProfileName(profile)}
									tags={profile?.event.tags ?? []}
									isAbout={true}
								/>
								のフィード
							</h1>
							<h3 class="Feed__subtitle">{idView} についてのエントリーを見る</h3>
							{#if loginPubkey !== undefined}
								<div class="Actions">
									{#if followingPubkeys.includes(currentPubkey)}
										<div title="お気に入りから削除" class="FavoriteButton FavoriteButton--active">
											<!-- svelte-ignore a11y_click_events_have_key_events -->
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												class="fa-fw fas fa-heart"
												onclick={() => {
													unfollowUser(currentPubkey);
												}}
											></span>
										</div>
									{:else}
										<div title="お気に入りに追加" class="FavoriteButton">
											<!-- svelte-ignore a11y_click_events_have_key_events -->
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												class="fa-fw fas fa-heart"
												onclick={() => {
													followUser(currentPubkey);
												}}
											></span>
										</div>
									{/if}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										title="設定"
										class={showSetting ? 'SettingButton SettingButton--active' : 'SettingButton'}
										onclick={() => {
											showSetting = !showSetting;
										}}
									>
										<div class="SettingButton__Button"><span class="fa-fw fas fa-cog"></span></div>
										<div class="SettingButton__Dropdown Dropdown--left">
											<!-- svelte-ignore a11y_missing_attribute -->
											{#if mutedPubkeys.includes(currentPubkey)}
												<a
													onclick={() => {
														unmuteUser(currentPubkey, loginPubkey);
													}}><i class="fa-fw fas fa-eye"></i> {idView} のミュートを解除</a
												>
											{:else}
												<a
													onclick={() => {
														muteUser(currentPubkey, loginPubkey);
													}}><i class="fa-fw fas fa-eye-slash"></i> {idView} をミュートする</a
												>
											{/if}
										</div>
									</div>
								</div>
							{/if}
						{:else if currentChannelId !== undefined}
							{@const channel = channelMap.get(currentChannelId)}
							{#if channel !== undefined}
								<h1 class="Feed__title"><i class="fa-fw fas fa-tags"></i> {channel.name}</h1>
								<h3 class="Feed__subtitle">{channel.name} についてのエントリーを見る</h3>
								{#if mutedChannelIds.includes(currentChannelId) && loginPubkey !== undefined}
									<span class="Feed__muted"
										><i class="fa-fw fas fa-eye-slash"></i>
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										このキーワードのエントリーはミュート中です。
										<span
											onclick={() => {
												unmuteChannel(currentChannelId, loginPubkey);
											}}>ミュートを解除</span
										></span
									>
								{/if}
								{#if loginPubkey !== undefined}
									<div class="Actions">
										{#if followingChannelIds.includes(currentChannelId)}
											<div title="お気に入りから削除" class="FavoriteButton FavoriteButton--active">
												<!-- svelte-ignore a11y_click_events_have_key_events -->
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<span
													class="fa-fw fas fa-heart"
													onclick={() => {
														unbookmarkChannel(currentChannelId, loginPubkey);
													}}
												></span>
											</div>
										{:else}
											<div title="お気に入りに追加" class="FavoriteButton">
												<!-- svelte-ignore a11y_click_events_have_key_events -->
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<span
													class="fa-fw fas fa-heart"
													onclick={() => {
														bookmarkChannel(currentChannelId);
													}}
												></span>
											</div>
										{/if}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											title="設定"
											class={showSetting ? 'SettingButton SettingButton--active' : 'SettingButton'}
											onclick={() => {
												showSetting = !showSetting;
											}}
										>
											<div class="SettingButton__Button">
												<span class="fa-fw fas fa-cog"></span>
											</div>
											<div class="SettingButton__Dropdown Dropdown--left">
												<!-- svelte-ignore a11y_missing_attribute -->
												{#if mutedChannelIds.includes(currentChannelId)}
													<a
														onclick={() => {
															unmuteChannel(currentChannelId, loginPubkey);
														}}><i class="fa-fw fas fa-eye"></i> {channel.name} のミュートを解除</a
													>
												{:else}
													<a
														onclick={() => {
															muteChannel(currentChannelId, loginPubkey);
														}}
														><i class="fa-fw fas fa-eye-slash"></i> {channel.name} をミュートする</a
													>
												{/if}
											</div>
										</div>
									</div>
								{/if}
							{/if}
						{:else if hashtag !== undefined}
							<h1 class="Feed__title"><i class="fa-fw fas fa-tags"></i> #{hashtag}</h1>
							<h3 class="Feed__subtitle">#{hashtag} についてのエントリーを見る</h3>
						{:else}
							<h1 class="Feed__title">最新の投稿</h1>
							<h3 class="Feed__subtitle">みんなでハイク</h3>
						{/if}
					</div>
				</div>
				<div class={loginPubkey === undefined ? 'Feed__composer Blurred' : 'Feed__composer'}>
					{#if loginPubkey === undefined}
						<div class="Overlay">
							<div class="LoginModal">
								<img src={serviceLogoImageUri} class="HatenaLogo" alt="" />
								<button
									class="Button Button--hatena"
									onclick={() => {
										document.dispatchEvent(new CustomEvent('nlLaunch', { detail: '' }));
									}}><span>Nostrでログイン</span></button
								>
							</div>
						</div>
					{/if}
					<CreateEntry
						{loginPubkey}
						{currentPubkey}
						{currentChannelId}
						{currentNoteId}
						{profileMap}
						{uploaderSelected}
						showForm={true}
					/>
				</div>
				<div class="FeedList">
					{#each timelineToShow as event (event.id)}
						<Entry
							{event}
							{channelMap}
							{profileMap}
							{loginPubkey}
							{mutedPubkeys}
							{mutedChannelIds}
							{mutedWords}
							{eventsTimeline}
							{eventsReaction}
							{uploaderSelected}
							{nowRealtime}
							level={0}
						/>
					{/each}
				</div>
			</div>
		</div>
		<div class="Column Column--right">
			{#if isAntenna ? loginPubkey !== undefined : currentPubkey !== undefined}
				{@const channelBookmarkIds = channelBookmarkMap.get(
					(isAntenna ? loginPubkey : currentPubkey)!
				)}
				<div class="Card">
					<div class="Card__head">
						<h3 class="Card__title"><i class="fa-fw fas fa-tags"></i> お気に入りキーワード</h3>
					</div>
					<div class="Card__body">
						<div class="KeywordList">
							{#if channelBookmarkIds !== undefined}
								<ul class="KeywordList__list">
									{#each channelBookmarkIds as channelId (channelId)}
										{@const channel = channelMap.get(channelId)}
										{#if channel !== undefined}
											<li class="KeywordItem">
												<a href="/keyword/{nip19.neventEncode(channel)}" class="KeywordItem__title"
													>{channel.name}</a
												>
											</li>
										{/if}
									{/each}
								</ul>
							{/if}
						</div>
					</div>
				</div>
			{:else if currentChannelId !== undefined}
				{@const channel = channelMap.get(currentChannelId)}
				{#if channel !== undefined}
					<div class="Card BlogTagsInfo">
						<div class="Card__head">
							<h3 class="Card__title">チャンネル情報</h3>
						</div>
						<ChannelMeta {channel} />
					</div>
				{/if}
			{:else}
				<div class="Card Card--kofi">
					<button
						class="Button"
						disabled={loginPubkey === undefined}
						data-npub={zapNpub}
						data-relays={zapRelays.join(',')}
					>
						<img alt="Zap" src={zapImageUri} />
						<span>Nos Haikuをサポート </span>
					</button>
				</div>
				<div class="Card">
					<div class="Card__head">
						<h3 class="Card__title">
							<i class="fa-fw fas fa-tags"></i> 注目のキーワード
						</h3>
					</div>
					<div class="Card__body">
						<div class="KeywordList">
							<ul class="KeywordList__list">
								{#each channelIds as channelId (channelId)}
									{@const channel = channelMap.get(channelId)}
									{#if channel?.id !== undefined}
										<li class="KeywordItem">
											<a href="/keyword/{nip19.neventEncode(channel)}" class="KeywordItem__title"
												>{channel.name}</a
											>
										</li>
									{/if}
								{/each}
							</ul>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</main>

<style>
	.SettingButton.SettingButton--active > .SettingButton__Dropdown {
		z-index: 2;
	}
	.Card--kofi button {
		width: 100%;
	}
</style>
