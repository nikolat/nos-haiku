<script lang="ts">
	import { getRoboHashURL, serviceIconImageUri, getUrlToLinkProfile } from '$lib/config';
	import type { ChannelContent, ProfileContentEvent } from '$lib/utils';
	import {
		followUser,
		getProfileName,
		muteUser,
		unfollowUser,
		unmuteUser
	} from '$lib/resource.svelte';
	import Content from '$lib/components/Content.svelte';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip05 from 'nostr-tools/nip05';
	import * as nip19 from 'nostr-tools/nip19';

	const {
		loginPubkey,
		currentPubkey,
		profileMap,
		profileEventMap,
		channelMap,
		eventsTimeline,
		eventsReaction,
		eventsEmojiSet,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		mutedHashTags,
		followingPubkeys
	}: {
		loginPubkey: string | undefined;
		currentPubkey: string;
		profileMap: Map<string, ProfileContentEvent>;
		profileEventMap: Map<string, NostrEvent>;
		channelMap: Map<string, ChannelContent>;
		eventsTimeline: NostrEvent[];
		eventsReaction: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashTags: string[];
		followingPubkeys: string[];
	} = $props();

	const prof = $derived(profileMap.get(currentPubkey));
	const nip05string: string | undefined = $derived(prof?.nip05);

	let showSetting: boolean = $state(false);
	const handlerSetting = (ev: MouseEvent): void => {
		const target: HTMLElement | null = ev.target as HTMLElement | null;
		if (!target?.closest('.Actions')) {
			showSetting = false;
		}
	};

	onMount(() => {
		document.addEventListener('click', handlerSetting);
	});
	beforeNavigate(() => {
		document.removeEventListener('click', handlerSetting);
	});
	afterNavigate(() => {
		document.addEventListener('click', handlerSetting);
	});
</script>

<div class="ProfileBox">
	<div class="ProfileBox__inner">
		<div
			class="ProfileBox--image"
			style={URL.canParse(prof?.banner ?? '')
				? `background-size: auto 100px; background-image: url("${prof?.banner}"); background-repeat: no-repeat; background-position: center; background-color: rgb(127, 127, 127);`
				: 'background-color: rgb(127, 127, 127);'}
		></div>
		<div class="ProfileBox__topline">
			<div
				class="ProfileBox__pfpwrapper"
				style="border-color: rgb(127, 127, 127); background-color: rgb(127, 127, 127);"
			>
				<div class="router-link-exact-active router-link-active">
					<img
						src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(currentPubkey))}
						alt="{getProfileName(prof)}のプロフィール画像"
					/>
				</div>
			</div>
			{#if loginPubkey !== undefined}
				{#if loginPubkey === currentPubkey}
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
							<div class="SettingButton__Dropdown Dropdown--right">
								<a href="/settings" class=""><i class="fa-fw fas fa-cog"></i> 設定</a>
							</div>
						</div>
					</div>
				{:else}
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
								<span class="fa-fw fas fa-ellipsis-h"></span>
							</div>
							<div class="SettingButton__Dropdown Dropdown--right">
								<!-- svelte-ignore a11y_missing_attribute -->
								{#if mutedPubkeys.includes(currentPubkey)}
									<a
										onclick={() => {
											unmuteUser(currentPubkey, loginPubkey);
										}}
										><i class="fa-fw fas fa-eye"></i>
										<Content
											content={getProfileName(prof)}
											tags={prof?.event.tags ?? []}
											isAbout={true}
										/>
										のミュートを解除</a
									>
								{:else}
									<a
										onclick={() => {
											muteUser(currentPubkey, loginPubkey);
										}}
										><i class="fa-fw fas fa-eye-slash"></i>
										<Content
											content={getProfileName(prof)}
											tags={prof?.event.tags ?? []}
											isAbout={true}
										/>
										をミュートする</a
									>
								{/if}
							</div>
						</div>
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
					</div>
				{/if}
			{/if}
		</div>
		<div class="ProfileBox__content">
			<h3 class="router-link-exact-active router-link-active">
				<Content content={getProfileName(prof)} tags={prof?.event.tags ?? []} isAbout={true} />
			</h3>
			<div class="HatenaID">
				<a
					href={getUrlToLinkProfile(nip19.npubEncode(currentPubkey))}
					target="_blank"
					rel="noopener noreferrer"
					><img alt="" src={serviceIconImageUri} />
					<h2>id:{prof?.name ?? 'none'}</h2></a
				>
			</div>
			{#if prof !== undefined}
				{#if nip05.isNip05(nip05string)}
					{@const abbreviatedNip05 = nip05string.replace(/^_@/, '')}
					{#await nip05.isValid(currentPubkey, nip05string)}
						<p>❔{abbreviatedNip05}</p>
					{:then isValid}
						<p>{isValid ? '✅' : '❌'}{abbreviatedNip05}</p>
					{:catch _error}
						<p>❌{abbreviatedNip05}</p>
					{/await}
				{/if}
				{#if URL.canParse(prof.website ?? '')}
					<p class="website">
						🔗<a href={prof.website} target="_blank" rel="noopener noreferrer">{prof.website}</a>
					</p>
				{/if}
			{/if}
			<p>
				<Content
					content={prof?.about ?? ''}
					tags={profileEventMap.get(currentPubkey)?.tags ?? []}
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
					uploaderSelected={''}
					channelToPost={undefined}
					currentChannelId={undefined}
					isEnabledRelativeTime={true}
					nowRealtime={0}
					level={0}
				/>
			</p>
		</div>
	</div>
</div>

<style>
	.SettingButton.SettingButton--active > .SettingButton__Dropdown {
		z-index: 2;
	}
</style>
