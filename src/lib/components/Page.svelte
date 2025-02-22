<script lang="ts">
	import {
		getRoboHashURL,
		serviceLogoImageUri,
		zapImageUri,
		zapNoteId,
		zapNpub,
		zapRelays
	} from '$lib/config';
	import {
		getEvent9734,
		zap,
		type ChannelContent,
		type ProfileContentEvent,
		type UrlParams
	} from '$lib/utils';
	import {
		bookmarkChannel,
		followUser,
		getChannelBookmarkMap,
		getEventByAddressPointer,
		getEventById,
		getEventsByKinds,
		getEventsChannel,
		getEventsEmojiSet,
		getEventsFirst,
		getEventsReaction,
		getEventsTimelineTop,
		getProfileId,
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
	import Profile from '$lib/components/kinds/Profile.svelte';
	import ChannelMeta from '$lib/components/kinds/ChannelMeta.svelte';
	import ChannelList from '$lib/components/kinds/ChannelList.svelte';
	import Header from '$lib/components/Header.svelte';
	import Content from '$lib/components/Content.svelte';
	import CreateEntry from '$lib/components/CreateEntry.svelte';
	import Entry from '$lib/components/Entry.svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import { unixNow } from 'applesauce-core/helpers';
	import { _ } from 'svelte-i18n';

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
		urlSearchParams: URLSearchParams;
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
	const kindSet: Set<number> = $derived.by(() => {
		const kindSet: Set<number> = new Set<number>();
		for (const [k, v] of urlSearchParams) {
			if (k === 'kind' && /^\d+$/.test(v)) {
				kindSet.add(parseInt(v));
			}
		}
		return kindSet;
	});
	const eventsTimeline: NostrEvent[] = $derived(
		category === undefined
			? kindSet.size === 0
				? getEventsTimelineTop()
				: getEventsByKinds(kindSet)
			: getEventsChannel()
	);
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
							!mutedWords.some((w) =>
								(channelMap.get(id)?.name?.toLowerCase() ?? '').includes(w)
							) &&
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
	const pinnedNotesEvent: NostrEvent | undefined = $derived(
		currentPubkey === undefined || currentNoteId !== undefined || kindSet.size > 0
			? undefined
			: getEventByAddressPointer({ identifier: '', pubkey: currentPubkey, kind: 10001 })
	);

	let countToShow: number = $state(10);

	const timelineAll: NostrEvent[] = $derived.by(() => {
		let tl: NostrEvent[];
		if (isAntenna) {
			tl = eventsTimeline.filter((ev) =>
				ev.kind === 9735
					? followingPubkeys.includes(getEvent9734(ev)?.pubkey ?? '')
					: followingPubkeys.includes(ev.pubkey)
			);
		} else if (currentNoteId !== undefined) {
			const entry = getEventById(currentNoteId);
			tl = entry !== undefined ? [entry] : [];
		} else if (currentAddressPointer !== undefined) {
			const entry = getEventByAddressPointer(currentAddressPointer);
			tl = entry !== undefined ? [entry] : [];
		} else if (currentPubkey !== undefined) {
			tl = eventsTimeline.filter((ev) =>
				ev.kind === 9735 ? getEvent9734(ev)?.pubkey === currentPubkey : ev.pubkey === currentPubkey
			);
		} else if (currentChannelId !== undefined) {
			tl = eventsTimeline.filter(
				(ev) =>
					(ev.kind === 42 &&
						ev.tags
							.filter((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
							.map((tag) => tag[1])
							.includes(currentChannelId)) ||
					(ev.kind === 16 &&
						ev.tags.some((tag) => tag.length >= 2 && tag[0] === 'k' && tag[1] === '42') &&
						getEventById(ev.tags.findLast((tag) => tag.length >= 2 && tag[0] === 'e')?.at(1) ?? '')
							?.tags.filter((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
							.map((tag) => tag[1])
							.includes(currentChannelId))
			);
		} else if (query !== undefined) {
			tl = eventsTimeline.filter((ev) => ev.content.toLowerCase().includes(query.toLowerCase()));
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
			if (kindSet.size === 0) {
				tl = eventsTimeline.filter(
					(ev) =>
						ev.kind === 42 ||
						(ev.kind === 16 &&
							ev.tags.some((tag) => tag.length >= 2 && tag[0] === 'k' && tag[1].includes('42')))
				);
			} else {
				tl = eventsTimeline;
			}
		}
		if (kindSet.size > 0) {
			tl = tl.filter((ev) => kindSet.has(ev.kind));
		}
		return tl;
	});
	const timelineSliced = $derived(timelineAll.slice(0, countToShow));
	const timelineMuted: NostrEvent[] = $derived(
		timelineSliced.filter((ev) => {
			const rootIds: string[] = ev.tags
				.filter((tag) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root')
				.map((tag) => tag.at(1))
				.filter((id) => id !== undefined);
			return (
				!(currentPubkey === undefined && mutedPubkeys.includes(ev.pubkey)) &&
				!(
					currentChannelId === undefined &&
					rootIds.some((rootId) => mutedChannelIds.includes(rootId))
				) &&
				!mutedWords.some(
					(word) =>
						ev.content.toLowerCase().includes(word) ||
						(ev.kind === 42 &&
							rootIds.some((rootId) =>
								(channelMap.get(rootId)?.name?.toLowerCase() ?? '').includes(word)
							))
				) &&
				!mutedHashTags.some(
					(t) =>
						([1, 42].includes(ev.kind) &&
							ev.tags
								.filter((tag) => tag.length >= 2 && tag[0] === 't')
								.map((tag) => tag.at(1)?.toLowerCase())
								.filter((s) => s !== undefined)
								.includes(t)) ||
						(ev.kind === 42 &&
							rootIds.some((rootId) => (channelMap.get(rootId)?.categories ?? []).includes(t)))
				)
			);
		})
	);
	const maxToShow = 30;
	const startToShow = $derived(
		timelineMuted.length <= maxToShow ? 0 : timelineMuted.length - maxToShow
	);
	const endToShow = $derived(timelineMuted.length);
	const timelineToShow = $derived(timelineMuted.slice(startToShow, endToShow));

	let isScrolledBottom = false;
	const scrollThreshold = 300;

	const urlParams: UrlParams = $derived({
		currentPubkey,
		currentChannelId,
		currentNoteId,
		currentAddressPointer,
		isAntenna,
		urlSearchParams
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
		const pageMostTop = 0;
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
						if (countToShow > maxToShow) {
							const lastChild = document.querySelector('.FeedList > .Entry:last-child');
							setTimeout(() => {
								lastChild?.scrollIntoView({ block: 'end' });
								isLoading = false;
							}, 10);
						} else {
							isLoading = false;
						}
					},
					false
				);
			}
		} else if (isScrolledBottom && scrollTop < pageMostBottom + scrollThreshold) {
			isScrolledBottom = false;
		}
		if (scrollTop === pageMostTop) {
			countToShow = countToShow - 10 < 10 ? 10 : countToShow - 10;
			if (countToShow > 10) {
				setTimeout(() => {
					window.scrollBy({ top: 10, behavior: 'smooth' });
				}, 100);
			}
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
						<h3 class="Card__title">
							<i class="fa-fw fas fa-users"></i>{$_('Page.left.recent-users')}
						</h3>
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
							<h1 class="Feed__title">
								<i class="fa-fw fas fa-broadcast-tower"></i>
								{$_('Page.main.antenna-title')}
							</h1>
							<h3 class="Feed__subtitle">{$_('Page.main.antenna-subtitle')}</h3>
						{:else if currentNoteId !== undefined}
							{#if currentPubkey !== undefined}
								{@const profile = profileMap.get(currentPubkey)}
								<h1 class="Feed__title">
									<Content
										content={getProfileName(profile)}
										tags={profile?.event.tags ?? []}
										isAbout={true}
									/>
									{$_('Page.main.entry-of')}
								</h1>
							{:else}
								<h1 class="Feed__title">{$_('Page.main.entry')}</h1>
							{/if}
						{:else if currentPubkey !== undefined}
							{@const profile = profileMap.get(currentPubkey)}
							{@const idView = getProfileId(profile)}
							<h1 class="Feed__title">
								<i class="fa-fw fas fa-book-user"></i>
								<Content
									content={getProfileName(profile)}
									tags={profile?.event.tags ?? []}
									isAbout={true}
								/>
								{$_('Page.main.feed-of')}
							</h1>
							<h3 class="Feed__subtitle">
								{$_('Page.main.feed-subtitle-entry').replace('{idView}', idView)}
							</h3>
							{#if loginPubkey !== undefined}
								<div class="Actions">
									{#if followingPubkeys.includes(currentPubkey)}
										<div
											title={$_('Page.main.remove-from-favorites')}
											class="FavoriteButton FavoriteButton--active"
										>
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
										<div title={$_('Page.main.add-to-favorites')} class="FavoriteButton">
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
										title={$_('Page.main.settings')}
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
													title={$_('Page.main.unmute-it').replace('{idView}', idView)}
													onclick={() => {
														unmuteUser(currentPubkey, loginPubkey);
													}}
													><i class="fa-fw fas fa-eye"></i>
													{$_('Page.main.unmute-it').replace('{idView}', idView)}</a
												>
											{:else}
												<a
													title={$_('Page.main.mute-it').replace('{idView}', idView)}
													onclick={() => {
														muteUser(currentPubkey, loginPubkey);
													}}
													><i class="fa-fw fas fa-eye-slash"></i>
													{$_('Page.main.mute-it').replace('{idView}', idView)}</a
												>
											{/if}
											<a
												title={$_('Page.main.view-custom-emoji').replace('{idView}', idView)}
												href={`/entry/${nip19.naddrEncode({ identifier: '', pubkey: currentPubkey, kind: 10030 })}`}
												><i class="fa-fw fas fa-smile"></i>
												{$_('Page.main.view-custom-emoji').replace('{idView}', idView)}</a
											>
										</div>
									</div>
								</div>
							{/if}
						{:else if currentChannelId !== undefined}
							{@const channel = channelMap.get(currentChannelId)}
							{#if channel?.name !== undefined}
								<h1 class="Feed__title"><i class="fa-fw fas fa-tags"></i> {channel.name}</h1>
								<h3 class="Feed__subtitle">
									{$_('Page.main.feed-subtitle-entry').replace('{idView}', channel.name)}
								</h3>
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
											}}><span>{$_('Page.main.add')}</span></button
										>
									</dl>
									<div class="CreateEntry__actions">
										<button
											class="Button"
											disabled={editChannelName.length === 0}
											onclick={() => {
												callSendChannelEdit(channel);
											}}><span>{$_('Page.main.send')}</span></button
										>
										<button
											class="Button Button--cancel"
											onclick={() => {
												isEnabledToEditChannel = false;
											}}><span>{$_('Page.main.cancel')}</span></button
										>
									</div>
								{/if}
								{#if loginPubkey !== undefined}
									{#if mutedChannelIds.includes(currentChannelId)}
										<span class="Feed__muted"
											><i class="fa-fw fas fa-eye-slash"></i>
											{$_('Page.main.muted-entries-keyword')}
											<!-- svelte-ignore a11y_click_events_have_key_events -->
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												onclick={() => {
													unmuteChannel(currentChannelId, loginPubkey);
												}}>{$_('Page.main.unmute')}</span
											></span
										>
									{/if}
									<div class="Actions">
										{#if followingChannelIds.includes(currentChannelId)}
											<div
												title={$_('Page.main.remove-from-favorites')}
												class="FavoriteButton FavoriteButton--active"
											>
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
											<div title={$_('Page.main.add-to-favorites')} class="FavoriteButton">
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
											title={$_('Page.main.settings')}
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
														title={$_('Page.main.unmute-it').replace('{idView}', channel.name)}
														onclick={() => {
															unmuteChannel(currentChannelId, loginPubkey);
														}}
														><i class="fa-fw fas fa-eye"></i>
														{$_('Page.main.unmute-it').replace('{idView}', channel.name)}</a
													>
												{:else}
													<a
														title={$_('Page.main.mute-it').replace('{idView}', channel.name)}
														onclick={() => {
															muteChannel(currentChannelId, loginPubkey);
														}}
														><i class="fa-fw fas fa-eye-slash"></i>
														{$_('Page.main.mute-it').replace('{idView}', channel.name)}</a
													>
												{/if}
												{#if channel.pubkey === loginPubkey}
													<a
														title={$_('Page.main.edit-it').replace('{idEdit}', channel.name)}
														onclick={() => {
															isEnabledToEditChannel = true;
															editChannelName = channel.name ?? '';
															editChannelAbout = channel.about ?? '';
															editChannelPicture = channel.picture ?? '';
															editChannelTags = channel.categories;
														}}
														><i class="fa-fw fas fa-edit"></i>
														{$_('Page.main.edit-it').replace('{idEdit}', channel.name)}</a
													>
													<a
														title={$_('Page.main.delete-it').replace('{idDelete}', channel.name)}
														onclick={() => {
															if (confirm($_('confirm-channel-delete'))) {
																sendDeletion(channel.eventkind40);
															}
														}}
														><i class="fa-fw fas fa-times-circle"></i>
														{$_('Page.main.delete-it').replace('{idDelete}', channel.name)}</a
													>
												{/if}
											</div>
										</div>
									</div>
								{/if}
							{/if}
						{:else if hashtag !== undefined}
							<h1 class="Feed__title"><i class="fa-fw fas fa-tags"></i> #{hashtag}</h1>
							<h3 class="Feed__subtitle">
								{$_('Page.main.feed-subtitle-entry').replace('{idView}', `#${hashtag}`)}
							</h3>
							{#if loginPubkey !== undefined}
								{#if mutedHashTags.includes(hashtag)}
									<span class="Feed__muted"
										><i class="fa-fw fas fa-eye-slash"></i>
										{$_('Page.main.muted-entries-hashtag')}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span
											onclick={() => {
												unmuteHashTag(hashtag, loginPubkey);
											}}>{$_('Page.main.unmute')}</span
										></span
									>
								{/if}
								<div class="Actions">
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										title={$_('Page.main.settings')}
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
													title={$_('Page.main.unmute-it').replace('{idView}', `#${hashtag}`)}
													onclick={() => {
														unmuteHashTag(hashtag, loginPubkey);
													}}
													><i class="fa-fw fas fa-eye"></i>
													{$_('Page.main.unmute-it').replace('{idView}', `#${hashtag}`)}</a
												>
											{:else}
												<a
													title={$_('Page.main.mute-it').replace('{idView}', `#${hashtag}`)}
													onclick={() => {
														muteHashTag(hashtag, loginPubkey);
													}}
													><i class="fa-fw fas fa-eye-slash"></i>
													{$_('Page.main.mute-it').replace('{idView}', `#${hashtag}`)}</a
												>
											{/if}
										</div>
									</div>
								</div>
							{/if}
						{:else if category !== undefined}
							<h1 class="Feed__title"><i class="fa-fw fas fa-tags"></i> #{category}</h1>
							<h3 class="Feed__subtitle">
								{$_('Page.main.feed-subtitle-keyword').replace('{idView}', `#${category}`)}
							</h3>
							{#if loginPubkey !== undefined}
								{#if mutedHashTags.includes(category)}
									<span class="Feed__muted"
										><i class="fa-fw fas fa-eye-slash"></i>
										{$_('Page.main.muted-keywords-category')}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span
											onclick={() => {
												unmuteHashTag(category, loginPubkey);
											}}>{$_('Page.main.unmute')}</span
										></span
									>
								{/if}
								<div class="Actions">
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										title={$_('Page.main.settings')}
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
													title={$_('Page.main.unmute-it').replace('{idView}', `#${category}`)}
													onclick={() => {
														unmuteHashTag(category, loginPubkey);
													}}
													><i class="fa-fw fas fa-eye"></i>
													{$_('Page.main.unmute-it').replace('{idView}', `#${category}`)}</a
												>
											{:else}
												<a
													title={$_('Page.main.mute-it').replace('{idView}', `#${category}`)}
													onclick={() => {
														muteHashTag(category, loginPubkey);
													}}
													><i class="fa-fw fas fa-eye-slash"></i>
													{$_('Page.main.mute-it').replace('{idView}', `#${category}`)}</a
												>
											{/if}
										</div>
									</div>
								</div>
							{/if}
						{:else}
							<h1 class="Feed__title">{$_('Page.main.latest-posts-title')}</h1>
							<h3 class="Feed__subtitle">{$_('Page.main.latest-posts-subtitle')}</h3>
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
									}}><span>{$_('Page.main.login-with-nostr')}</span></button
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
						{eventsEmojiSet}
						bind:channelToPost
						showForm={true}
					/>
				</div>
				<div class="FeedList">
					{#if pinnedNotesEvent !== undefined && pinnedNotesEvent.tags.filter((tag) => tag.length >= 2 && tag[0] === 'e').length > 0}
						<Entry
							event={pinnedNotesEvent}
							{channelMap}
							{profileMap}
							{loginPubkey}
							{mutedPubkeys}
							{mutedChannelIds}
							{mutedWords}
							{mutedHashTags}
							{followingPubkeys}
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
					{/if}
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
							{followingPubkeys}
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
						<h3 class="Card__title">
							<i class="fa-fw fas fa-tags"></i>
							{$_('Page.right.favorite-keywords')}
						</h3>
					</div>
					<div class="Card__body">
						<div class="KeywordList">
							{#if channelBookmarkIds !== undefined}
								<ChannelList
									channelIds={channelBookmarkIds}
									{loginPubkey}
									{channelMap}
									bind:channelToPost
								/>
							{/if}
						</div>
					</div>
				</div>
			{:else if currentChannelId !== undefined}
				{@const channel = channelMap.get(currentChannelId)}
				{#if channel !== undefined}
					<div class="Card BlogTagsInfo">
						<div class="Card__head">
							<h3 class="Card__title">{$_('Page.right.channel-info')}</h3>
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
						<span>{$_('Page.right.support-nos-haiku')}</span>
					</button>
					<div class="zap-window-container" bind:this={zapWindowContainer}></div>
				</div>
				<div class="Card">
					<div class="Card__head">
						<h3 class="Card__title">
							<i class="fa-fw fas fa-tags"></i>
							{$_('Page.right.hot-keywords')}
						</h3>
					</div>
					<div class="Card__body">
						<div class="KeywordList">
							<ChannelList {channelIds} {loginPubkey} {channelMap} bind:channelToPost />
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</main>

<style>
	.SettingButton.SettingButton--active > .SettingButton__Dropdown {
		white-space: nowrap;
		z-index: 2;
	}
	.Card--kofi button {
		width: 100%;
	}
	button.category-delete {
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
	button:disabled.category-delete {
		cursor: not-allowed;
	}
	button.category-delete > svg {
		width: 16px;
		height: 16px;
		fill: var(--secondary-text-color);
	}
	button:active.category-delete > svg {
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
