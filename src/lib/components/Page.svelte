<script lang="ts">
	import {
		getRoboHashURL,
		serviceLogoImageUri,
		zapImageUri,
		zapNoteId,
		zapNpub,
		zapRelays
	} from '$lib/config';
	import { zap, type ChannelContent, type ProfileContentEvent, type UrlParams } from '$lib/utils';
	import {
		bookmarkChannel,
		followUser,
		getChannelBookmarkMap,
		getEventByAddressPointer,
		getEventById,
		getEventsEmojiSet,
		getEventsChannel,
		getEventsFirst,
		getEventsReaction,
		getEventsTimelineTop,
		getProfileEventMap,
		getProfileName,
		muteChannel,
		muteHashTag,
		muteUser,
		sendChannelEdit,
		sendDeletion,
		unbookmarkChannel,
		unfollowUser,
		unmuteChannel,
		unmuteHashTag,
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

	let {
		loginPubkey,
		isAntenna,
		currentPubkey,
		currentChannelId,
		currentNoteId,
		currentAddressPointer,
		query,
		urlSearchParams,
		hashtag,
		category,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		mutedHashTags,
		followingPubkeys,
		uploaderSelected,
		isEnabledRelativeTime,
		nowRealtime,
		isLoading = $bindable()
	}: {
		loginPubkey: string | undefined;
		isAntenna: boolean | undefined;
		currentPubkey: string | undefined;
		currentChannelId: string | undefined;
		currentNoteId: string | undefined;
		currentAddressPointer: nip19.AddressPointer | undefined;
		query: string | undefined;
		urlSearchParams: URLSearchParams | undefined;
		hashtag: string | undefined;
		category: string | undefined;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashTags: string[];
		followingPubkeys: string[];
		uploaderSelected: string;
		isEnabledRelativeTime: boolean;
		nowRealtime: number;
		isLoading: boolean;
	} = $props();

	const isTopPage: boolean = $derived(
		[
			currentNoteId,
			currentPubkey,
			currentChannelId,
			currentAddressPointer,
			hashtag,
			category
		].every((q) => q === undefined) && !isAntenna
	);
	const eventsTimeline: NostrEvent[] = $derived(
		category === undefined ? getEventsTimelineTop() : getEventsChannel()
	);
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
							!mutedChannelIds.includes(id) &&
							!mutedWords.some((w) => (channelMap.get(id)?.name.toLowerCase() ?? '').includes(w)) &&
							!mutedHashTags.some((t) => (channelMap.get(id)?.categories ?? []).includes(t))
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
							return ev.tags.some(
								(tag) => tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag
							);
						} else {
							const rootId =
								ev.tags
									.find((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
									?.at(1) ?? '';
							return !mutedChannelIds.includes(rootId);
						}
					})
					.map((ev) => ev.pubkey)
			)
		).filter((pubkey) => !mutedPubkeys.includes(pubkey))
	);
	const eventsReaction: NostrEvent[] = $derived(getEventsReaction());
	const eventsEmojiSet: NostrEvent[] = $derived(getEventsEmojiSet());

	let countToShow: number = $state(10);

	const timelineAll: NostrEvent[] = $derived.by(() => {
		let tl: NostrEvent[];
		if (isAntenna) {
			tl = eventsTimeline.filter((ev) => followingPubkeys.includes(ev.pubkey));
		} else if (currentNoteId !== undefined) {
			const entry = getEventById(currentNoteId);
			tl = entry !== undefined ? [entry] : [];
		} else if (currentAddressPointer !== undefined) {
			const entry = getEventByAddressPointer(currentAddressPointer);
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
		} else if (query !== undefined) {
			if (urlSearchParams !== undefined) {
				const kinds: number[] = [];
				for (const [k, v] of urlSearchParams) {
					if (k === 'kind' && /^\d+$/.test(v)) {
						kinds.push(parseInt(v));
					}
				}
				tl = eventsTimeline.filter(
					(ev) => kinds.includes(ev.kind) && ev.content.toLowerCase().includes(query.toLowerCase())
				);
			} else {
				tl = eventsTimeline.filter((ev) => ev.content.toLowerCase().includes(query.toLowerCase()));
			}
		} else if (hashtag !== undefined) {
			tl = eventsTimeline.filter((ev) =>
				ev.tags.some((tag) => tag.length >= 2 && tag[0] === 't' && tag[1].toLowerCase() === hashtag)
			);
		} else if (category !== undefined) {
			tl = eventsTimeline.filter((ev) => {
				const channel = channelMap.get(ev.id);
				return channel?.categories.includes(category) === true;
			});
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
						ev.content.toLowerCase().includes(word) ||
						(ev.kind === 42 &&
							(channelMap.get(rootId ?? '')?.name.toLowerCase() ?? '').includes(word))
				) &&
				!mutedHashTags.some(
					(t) =>
						ev.tags
							.filter((tag) => tag.length >= 2 && tag[0] === 't')
							.map((tag) => tag[1].toLowerCase())
							.includes(t) ||
						(ev.kind === 42 && (channelMap.get(rootId ?? '')?.categories ?? []).includes(t))
				) &&
				!(ev.kind === 42 && rootId === undefined)
			);
		})
	);

	let isScrolledBottom = false;
	const scrollThreshold = 300;

	const urlParams: UrlParams = $derived({
		currentPubkey,
		currentChannelId,
		currentNoteId,
		currentAddressPointer,
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
			if (isEnabledScrollInfinitely && !isScrolledBottom && !isLoading) {
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

	let channelToPost: ChannelContent | undefined = $state();
	let isEnabledScrollInfinitely: boolean = $state(true);
	let zapWindowContainer: HTMLElement | undefined = $state();
	let isEnabledToEditChannel: boolean = $state(false);
	let editChannelName: string = $state('');
	let editChannelAbout: string = $state('');
	let editChannelPicture: string = $state('');
	let editChannelTag: string = $state('');
	let editChannelTags: string[] = $state([]);
	let editChannelTagInput: HTMLInputElement | undefined = $state();

	const callSendChannelEdit = async (channel: ChannelContent) => {
		const c: ChannelContent = { ...channel };
		c.name = editChannelName;
		c.about = editChannelAbout;
		c.picture = editChannelPicture;
		c.categories = editChannelTags;
		await sendChannelEdit(c);
		editChannelName = '';
		editChannelAbout = '';
		editChannelPicture = '';
		editChannelTag = '';
		editChannelTags = [];
		isEnabledToEditChannel = false;
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

<Header
	{loginPubkey}
	{query}
	{urlSearchParams}
	{profileMap}
	{mutedPubkeys}
	{mutedWords}
	{mutedHashTags}
	{isEnabledRelativeTime}
	{nowRealtime}
	bind:isEnabledScrollInfinitely
/>
<main class="Homepage View">
	<div class="Layout">
		<div
			class={currentPubkey === undefined
				? 'Column Column--left Column--nomobile'
				: 'Column Column--left'}
		>
			<div class={currentPubkey === undefined ? 'Card' : 'Card Card--nomargin'}>
				{#if currentPubkey === undefined}
					<div class="Card__head">
						<h3 class="Card__title"><i class="fa-fw fas fa-users"></i>ユーザー一覧</h3>
					</div>
				{/if}
				<div class={currentPubkey === undefined ? 'Card__body' : 'Card__body Card__body--nopad'}>
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
							{eventsEmojiSet}
							{mutedPubkeys}
							{mutedChannelIds}
							{mutedWords}
							{mutedHashTags}
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
													title={`${idView} のミュートを解除`}
													onclick={() => {
														unmuteUser(currentPubkey, loginPubkey);
													}}><i class="fa-fw fas fa-eye"></i> {idView} のミュートを解除</a
												>
											{:else}
												<a
													title={`${idView} をミュートする`}
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
								{#if channel.categories.length > 0}
									<div class="categories">
										{#each channel.categories as category (category)}
											<a class="category" href="/category/{encodeURI(category)}">#{category}</a>
										{/each}
									</div>
								{/if}
								{#if isEnabledToEditChannel}
									<dl class="edit-channel">
										<dt><label for="edit-channel-name">Name</label></dt>
										<dd>
											<input
												id="edit-channel-name"
												class="RichTextEditor ql-editor"
												type="text"
												placeholder="channel name"
												bind:value={editChannelName}
											/>
										</dd>
										<dt><label for="edit-channel-about">About</label></dt>
										<dd>
											<textarea
												id="edit-channel-about"
												class="RichTextEditor ql-editor"
												placeholder="channel description"
												bind:value={editChannelAbout}
											></textarea>
										</dd>
										<dt><label for="edit-channel-picture">Picture</label></dt>
										<dd>
											<input
												id="edit-channel-picture"
												class="RichTextEditor ql-editor"
												type="url"
												placeholder="https://..."
												bind:value={editChannelPicture}
											/>
										</dd>
										<dt>
											<label for="edit-channel-category">Category</label>
											{#each editChannelTags as tTag (tTag)}
												<span class="category-tag">#{tTag}</span><button
													class="category-delete"
													title="delete the category"
													onclick={() => {
														editChannelTags = editChannelTags.filter((t) => t !== tTag);
													}}
													aria-label="delete the category"
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="16"
														height="16"
														viewBox="0 0 16 16"
													>
														<path
															fill-rule="evenodd"
															d="M8,16 C3.581722,16 0,12.418278 0,8 C0,3.581722 3.581722,0 8,0 C12.418278,0 16,3.581722 16,8 C16,12.418278 12.418278,16 8,16 Z M8,14 C11.3137085,14 14,11.3137085 14,8 C14,4.6862915 11.3137085,2 8,2 C4.6862915,2 2,4.6862915 2,8 C2,11.3137085 4.6862915,14 8,14 Z M8,9.41421356 L5.70710678,11.7071068 L4.29289322,10.2928932 L6.58578644,8 L4.29289322,5.70710678 L5.70710678,4.29289322 L8,6.58578644 L10.2928932,4.29289322 L11.7071068,5.70710678 L9.41421356,8 L11.7071068,10.2928932 L10.2928932,11.7071068 L8,9.41421356 Z"
														/>
													</svg>
												</button>
											{/each}
										</dt>
										<dd>
											<input
												id="edit-channel-category"
												class="RichTextEditor ql-editor"
												type="text"
												placeholder="category"
												pattern="[^\s#]+"
												bind:value={editChannelTag}
												bind:this={editChannelTagInput}
											/>
										</dd>
										<button
											class="Button"
											disabled={editChannelTag.length === 0 ||
												editChannelTagInput.validity.patternMismatch ||
												editChannelTags
													.map((t) => t.toLowerCase())
													.includes(editChannelTag.toLowerCase())}
											onclick={() => {
												editChannelTags.push(editChannelTag.toLowerCase());
												editChannelTag = '';
											}}><span>追加</span></button
										>
									</dl>
									<div class="CreateEntry__actions">
										<button
											class="Button"
											disabled={editChannelName.length === 0}
											onclick={() => {
												callSendChannelEdit(channel);
											}}><span>送信</span></button
										>
										<button
											class="Button Button--cancel"
											onclick={() => {
												isEnabledToEditChannel = false;
											}}><span>キャンセル</span></button
										>
									</div>
								{/if}
								{#if loginPubkey !== undefined}
									{#if mutedChannelIds.includes(currentChannelId)}
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
											<!-- svelte-ignore a11y_missing_attribute -->
											<div class="SettingButton__Dropdown Dropdown--left">
												{#if mutedChannelIds.includes(currentChannelId)}
													<a
														title={`${channel.name} のミュートを解除`}
														onclick={() => {
															unmuteChannel(currentChannelId, loginPubkey);
														}}><i class="fa-fw fas fa-eye"></i> {channel.name} のミュートを解除</a
													>
												{:else}
													<a
														title={`${channel.name} をミュートする`}
														onclick={() => {
															muteChannel(currentChannelId, loginPubkey);
														}}
														><i class="fa-fw fas fa-eye-slash"></i> {channel.name} をミュートする</a
													>
												{/if}
												{#if channel.pubkey === loginPubkey}
													<a
														title={`${channel.name} を編集する`}
														onclick={() => {
															isEnabledToEditChannel = true;
															editChannelName = channel.name;
															editChannelAbout = channel.about ?? '';
															editChannelPicture = channel.picture ?? '';
															editChannelTags = channel.categories;
														}}><i class="fa-fw fas fa-edit"></i> {channel.name} を編集する</a
													>
													<a
														title={`${channel.name} を削除する`}
														onclick={() => {
															if (confirm('このチャンネルを削除しますか？')) {
																sendDeletion(channel.eventkind40);
															}
														}}
														><i class="fa-fw fas fa-times-circle"></i> {channel.name} を削除する</a
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
							{#if loginPubkey !== undefined}
								{#if mutedHashTags.includes(hashtag)}
									<span class="Feed__muted"
										><i class="fa-fw fas fa-eye-slash"></i>
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										このハッシュタグのエントリーはミュート中です。
										<span
											onclick={() => {
												unmuteHashTag(hashtag, loginPubkey);
											}}>ミュートを解除</span
										></span
									>
								{/if}
								<div class="Actions">
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
										<!-- svelte-ignore a11y_missing_attribute -->
										<div class="SettingButton__Dropdown Dropdown--left">
											{#if mutedHashTags.includes(hashtag)}
												<a
													title={`${hashtag} のミュートを解除`}
													onclick={() => {
														unmuteHashTag(hashtag, loginPubkey);
													}}><i class="fa-fw fas fa-eye"></i> #{hashtag} のミュートを解除</a
												>
											{:else}
												<a
													title={`${hashtag} をミュートする`}
													onclick={() => {
														muteHashTag(hashtag, loginPubkey);
													}}><i class="fa-fw fas fa-eye-slash"></i> #{hashtag} をミュートする</a
												>
											{/if}
										</div>
									</div>
								</div>
							{/if}
						{:else if category !== undefined}
							<h1 class="Feed__title"><i class="fa-fw fas fa-tags"></i> #{category}</h1>
							<h3 class="Feed__subtitle">#{category} についてのキーワードを見る</h3>
							{#if loginPubkey !== undefined}
								{#if mutedHashTags.includes(category)}
									<span class="Feed__muted"
										><i class="fa-fw fas fa-eye-slash"></i>
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										このカテゴリーのキーワードはミュート中です。
										<span
											onclick={() => {
												unmuteHashTag(category, loginPubkey);
											}}>ミュートを解除</span
										></span
									>
								{/if}
								<div class="Actions">
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
										<!-- svelte-ignore a11y_missing_attribute -->
										<div class="SettingButton__Dropdown Dropdown--left">
											{#if mutedHashTags.includes(category)}
												<a
													title={`${category} のミュートを解除`}
													onclick={() => {
														unmuteHashTag(category, loginPubkey);
													}}><i class="fa-fw fas fa-eye"></i> #{category} のミュートを解除</a
												>
											{:else}
												<a
													title={`${category} をミュートする`}
													onclick={() => {
														muteHashTag(category, loginPubkey);
													}}><i class="fa-fw fas fa-eye-slash"></i> #{category} をミュートする</a
												>
											{/if}
										</div>
									</div>
								</div>
							{/if}
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
						{currentChannelId}
						eventToReply={undefined}
						{isTopPage}
						{profileMap}
						{uploaderSelected}
						bind:channelToPost
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
							{mutedHashTags}
							{eventsTimeline}
							{eventsReaction}
							{eventsEmojiSet}
							{uploaderSelected}
							bind:channelToPost
							{currentChannelId}
							{isEnabledRelativeTime}
							{nowRealtime}
							level={0}
						/>
					{/each}
				</div>
				{#if isLoading}
					<div class="Spinner">
						<span class="Spinner__image">
							<img src="/apple-touch-icon.png" alt="" />
						</span>
					</div>
				{/if}
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
												<span class="post-channel">
													<button
														aria-label="Post to this keyword"
														class="post-chennel"
														disabled={loginPubkey === undefined}
														title="Post to this keyword"
														onclick={() => {
															channelToPost = channel;
															window.scroll({
																top: 0,
																behavior: 'smooth'
															});
														}}
													>
														<svg
															xmlns="http://www.w3.org/2000/svg"
															width="24"
															height="24"
															viewBox="0 0 24 24"
														>
															<path
																fill-rule="evenodd"
																d="M12,21.2037682 L1.48140774,12 L12,2.79623177 L12,8.02302014 C18.5486628,8.33140969 22,11.7344566 22,18 L22,20.4142136 L20.2928932,18.7071068 C18.0460687,16.4602823 15.3097943,15.5189215 12,15.8718462 L12,21.2037682 Z M10,7.20376823 L4.51859226,12 L10,16.7962318 L10,14.1528729 L10.835601,14.0136061 C14.2501827,13.4445091 17.255572,14.0145027 19.7987459,15.7165365 C19.0504666,11.8510227 16.2006399,10 11,10 L10,10 L10,7.20376823 Z"
															/>
														</svg>
													</button>
												</span>
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
						onclick={() => {
							zap(zapNpub, zapNoteId, zapRelays, zapWindowContainer);
						}}
					>
						<img alt="Zap" src={zapImageUri} />
						<span>Nos Haikuをサポート</span>
					</button>
					<div class="zap-window-container" bind:this={zapWindowContainer}></div>
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
											<span class="post-channel">
												<button
													aria-label="Post to this keyword"
													class="post-chennel"
													disabled={loginPubkey === undefined}
													title="Post to this keyword"
													onclick={() => {
														channelToPost = channel;
														window.scroll({
															top: 0,
															behavior: 'smooth'
														});
													}}
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="24"
														height="24"
														viewBox="0 0 24 24"
													>
														<path
															fill-rule="evenodd"
															d="M12,21.2037682 L1.48140774,12 L12,2.79623177 L12,8.02302014 C18.5486628,8.33140969 22,11.7344566 22,18 L22,20.4142136 L20.2928932,18.7071068 C18.0460687,16.4602823 15.3097943,15.5189215 12,15.8718462 L12,21.2037682 Z M10,7.20376823 L4.51859226,12 L10,16.7962318 L10,14.1528729 L10.835601,14.0136061 C14.2501827,13.4445091 17.255572,14.0145027 19.7987459,15.7165365 C19.0504666,11.8510227 16.2006399,10 11,10 L10,10 L10,7.20376823 Z"
														/>
													</svg>
												</button>
											</span>
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
	.KeywordItem span {
		font-size: 12px;
		margin-right: 3px;
	}
	button.category-delete,
	.KeywordItem span > button {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
		vertical-align: text-bottom;
	}
	button:disabled.category-delete,
	.KeywordItem span > button:disabled {
		cursor: not-allowed;
	}
	button.category-delete > svg,
	.KeywordItem span > button > svg {
		width: 16px;
		height: 16px;
		fill: var(--secondary-text-color);
	}
	button:active.category-delete > svg,
	.KeywordItem span > button:active > svg {
		fill: yellow;
	}
	/* ミュートされた投稿が多すぎてスクロールできず追加読み込みができない場合への備え */
	.Homepage {
		min-height: calc(100vh + 300px);
	}
	.Spinner {
		opacity: unset;
	}
	.Spinner__image img {
		width: 64px;
		height: 64px;
	}
	.edit-channel input,
	.edit-channel textarea {
		appearance: none;
		border-radius: 4px;
		font: inherit;
		outline: none;
		width: 100%;
		resize: none;
	}
	.category-tag {
		margin-left: 0.5em;
	}
	input#edit-channel-category:invalid {
		border: red solid 1px;
	}
	.categories .category {
		margin-right: 0.5em;
	}
</style>
