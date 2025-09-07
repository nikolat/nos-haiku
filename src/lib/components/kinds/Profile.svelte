<script lang="ts">
	import { getRoboHashURL, serviceIconImageUri, getUrlToLinkProfile } from '$lib/config';
	import {
		getName,
		loginWithNpub,
		type ChannelContent,
		type ProfileContentEvent
	} from '$lib/utils';
	import type { RelayConnector } from '$lib/resource';
	import Content from '$lib/components/Content.svelte';
	import Badges from '$lib/components/kinds/Badges.svelte';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { NostrEvent } from 'nostr-tools/pure';
	import * as nip05 from 'nostr-tools/nip05';
	import * as nip19 from 'nostr-tools/nip19';
	import type { ProfileContent } from 'applesauce-core/helpers';
	import { _ } from 'svelte-i18n';

	const {
		rc,
		loginPubkey,
		currentPubkey,
		profileMap,
		channelMap,
		eventsTimeline,
		eventsQuoted,
		eventsReaction,
		eventsBadge,
		eventsPoll,
		eventsEmojiSet,
		eventsChannelBookmark,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		mutedHashtags,
		followingPubkeys,
		eventFollowList,
		eventEmojiSetList,
		eventMuteList
	}: {
		rc: RelayConnector | undefined;
		loginPubkey: string | undefined;
		currentPubkey: string;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		eventsTimeline: NostrEvent[];
		eventsQuoted: NostrEvent[];
		eventsReaction: NostrEvent[];
		eventsBadge: NostrEvent[];
		eventsPoll: NostrEvent[];
		eventsEmojiSet: NostrEvent[];
		eventsChannelBookmark: NostrEvent[];
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashtags: string[];
		followingPubkeys: string[];
		eventFollowList: NostrEvent | undefined;
		eventEmojiSetList: NostrEvent | undefined;
		eventMuteList: NostrEvent | undefined;
	} = $props();

	const name = $derived(getName(currentPubkey, profileMap, eventFollowList));
	const prof = $derived(profileMap.get(currentPubkey));
	const display_name = $derived(
		prof?.display_name === undefined
			? getName(currentPubkey, profileMap, eventFollowList, false, true)
			: prof.display_name
	);
	const nip05string: string | undefined = $derived(prof?.nip05);

	const getEventById = (id: string, eventsAll: NostrEvent[]): NostrEvent | undefined => {
		return eventsAll.find((ev) => ev.id === id);
	};
	const getEventByAddressPointer = (
		data: nip19.AddressPointer,
		eventsAll: NostrEvent[]
	): NostrEvent | undefined => {
		return eventsAll.find(
			(ev) =>
				ev.pubkey === data.pubkey &&
				ev.kind === data.kind &&
				(ev.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '') === data.identifier
		);
	};

	const badgeEvent: NostrEvent | undefined = $derived(
		getEventByAddressPointer(
			{ kind: 30008, pubkey: currentPubkey, identifier: 'profile_badges' },
			eventsBadge
		)
	);

	let showSetting: boolean = $state(false);
	const handlerSetting = (ev: MouseEvent): void => {
		const target: HTMLElement | null = ev.target as HTMLElement | null;
		if (!target?.closest('.Actions')) {
			showSetting = false;
		}
	};

	const getProfileId = (prof: ProfileContent | undefined) => {
		let name = prof?.name !== undefined ? `id:${prof.name}` : 'anonymouse';
		if (name.length > 30) {
			name = `${name.slice(0, 25)}...`;
		}
		return name;
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
					<a href={resolve(`/${nip19.npubEncode(currentPubkey)}`)}>
						<img
							src={prof !== undefined && URL.canParse(prof.picture ?? '')
								? prof.picture
								: getRoboHashURL(nip19.npubEncode(currentPubkey))}
							alt={$_('Profile.profile-image-of').replace('{name}', name)}
						/>
					</a>
				</div>
			</div>
			{#if loginPubkey === currentPubkey}
				<div class="Actions">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						title={$_('Profile.settings')}
						class={showSetting ? 'SettingButton SettingButton--active' : 'SettingButton'}
						onclick={() => {
							showSetting = !showSetting;
						}}
					>
						<div class="SettingButton__Button">
							<span class="fa-fw fas fa-cog"></span>
						</div>
						<div class="SettingButton__Dropdown Dropdown--right">
							<a href={resolve('/settings')}>
								<i class="fa-fw fas fa-cog"></i>
								{$_('Profile.settings')}
							</a>
						</div>
					</div>
				</div>
			{:else}
				<div class="Actions">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						title={$_('Profile.settings')}
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
							{#if loginPubkey !== undefined}
								{#if mutedPubkeys.includes(currentPubkey)}
									<a
										onclick={() => {
											rc?.unmutePubkey(currentPubkey, loginPubkey, $state.snapshot(eventMuteList));
										}}
									>
										<i class="fa-fw fas fa-eye"></i>
										{$_('Profile.unmute-pre')}
										<Content content={name} tags={prof?.event.tags ?? []} isAbout={true} />
										{$_('Profile.unmute-suf')}
									</a>
								{:else}
									<a
										onclick={() => {
											rc?.mutePubkey(currentPubkey, loginPubkey, $state.snapshot(eventMuteList));
										}}
									>
										<i class="fa-fw fas fa-eye-slash"></i>
										{$_('Profile.mute-pre')}
										<Content content={name} tags={prof?.event.tags ?? []} isAbout={true} />
										{$_('Profile.mute-suf')}
									</a>
								{/if}
							{:else}
								<a
									title={`${$_('Profile.login-as-the-user-pre')}${name}${$_('Profile.login-as-the-user-suf')}`}
									onclick={() => {
										loginWithNpub(nip19.npubEncode(currentPubkey));
									}}
								>
									<i class="fa-fw fas fa-eye"></i>
									{$_('Profile.login-as-the-user-pre')}
									<Content content={name} tags={prof?.event.tags ?? []} isAbout={true} />
									{$_('Profile.login-as-the-user-suf')}
								</a>
							{/if}
							<a
								title={`${$_('Profile.view-custom-emoji-pre')}${name}${$_('Profile.view-custom-emoji-suf')}`}
								href={resolve(
									`/entry/${nip19.naddrEncode({ identifier: '', pubkey: currentPubkey, kind: 10030 })}`
								)}
							>
								<i class="fa-fw fas fa-smile"></i>
								{$_('Profile.view-custom-emoji-pre')}
								<Content content={name} tags={prof?.event.tags ?? []} isAbout={true} />
								{$_('Profile.view-custom-emoji-suf')}
							</a>
						</div>
					</div>
					{#if loginPubkey !== undefined}
						{#if followingPubkeys.includes(currentPubkey)}
							<div
								title={$_('Profile.remove-from-favorites')}
								class="FavoriteButton FavoriteButton--active"
							>
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									class="fa-fw fas fa-heart"
									onclick={() => {
										if (rc !== undefined && eventFollowList !== undefined) {
											rc.unfollowPubkey(currentPubkey, $state.snapshot(eventFollowList));
										}
									}}
								></span>
							</div>
						{:else}
							<div title={$_('Profile.add-to-favorites')} class="FavoriteButton">
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									class="fa-fw fas fa-heart"
									onclick={() => {
										rc?.followPubkey(currentPubkey, $state.snapshot(eventFollowList));
									}}
								></span>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
		<div class="ProfileBox__content">
			<Badges
				{currentPubkey}
				{badgeEvent}
				{eventsBadge}
				{getEventById}
				{getEventByAddressPointer}
			/>
			<h3 class="router-link-exact-active router-link-active">
				<a href={resolve(`/${nip19.npubEncode(currentPubkey)}`)}>
					<Content content={display_name} tags={prof?.event.tags ?? []} isAbout={true} />
				</a>
			</h3>
			<div class="HatenaID">
				<a
					href={getUrlToLinkProfile(nip19.npubEncode(currentPubkey))}
					target="_blank"
					rel="noopener noreferrer"
					><img alt="" src={serviceIconImageUri} />
					<h2>{getProfileId(prof)}</h2></a
				>
			</div>
			{#if prof !== undefined}
				{#if nip05.isNip05(nip05string)}
					{@const abbreviatedNip05 = nip05string.replace(/^_@/, '')}
					{#await nip05.isValid(currentPubkey, nip05string)}
						<p>❔{abbreviatedNip05}</p>
					{:then isValid}
						{#if isValid}
							<p>✅<a href={resolve(`/${abbreviatedNip05}`)}>{abbreviatedNip05}</a></p>
						{:else}
							<p>❌{abbreviatedNip05}</p>
						{/if}
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
					{rc}
					content={prof?.about ?? ''}
					tags={profileMap.get(currentPubkey)?.event.tags ?? []}
					{channelMap}
					{profileMap}
					{loginPubkey}
					{mutedPubkeys}
					{mutedChannelIds}
					{mutedWords}
					{mutedHashtags}
					{followingPubkeys}
					{eventFollowList}
					{eventEmojiSetList}
					{eventMuteList}
					{eventsTimeline}
					{eventsQuoted}
					{eventsReaction}
					{eventsBadge}
					{eventsPoll}
					{eventsEmojiSet}
					{eventsChannelBookmark}
					getSeenOn={() => {
						return [];
					}}
					uploaderSelected=""
					channelToPost={undefined}
					currentChannelId={undefined}
					isEnabledRelativeTime={true}
					isEnabledEventProtection={false}
					clientTag={undefined}
					nowRealtime={0}
					level={0}
					isPreview={false}
					callInsertText={() => {}}
				/>
			</p>
		</div>
	</div>
</div>

<style>
	.ProfileBox__content > h3 > a {
		color: var(--text-color);
	}
	.SettingButton.SettingButton--active > .SettingButton__Dropdown {
		white-space: nowrap;
		z-index: 2;
	}
</style>
