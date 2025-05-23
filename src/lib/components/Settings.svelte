<script lang="ts">
	import { uploaderURLs, urlToLinkProfileEditor } from '$lib/config';
	import type { ChannelContent, ProfileContentEvent } from '$lib/utils';
	import {
		clearCache,
		getRelaySets,
		getRelaysToUse,
		setIsEnabledDarkMode,
		setIsEnabledEventProtection,
		setIsEnabledOutboxModel,
		setIsEnabledRelativeTime,
		setIsEnabledSkipKind1,
		setIsEnabledUseClientTag,
		setLang,
		setRelaysSelected,
		setRelaysToUseSelected,
		setUploaderSelected
	} from '$lib/resource.svelte';
	import Profile from '$lib/components/kinds/Profile.svelte';
	import MuteList from '$lib/components/kinds/MuteList.svelte';
	import RelayList from '$lib/components/kinds/RelayList.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import type { NostrEvent } from 'nostr-tools/pure';
	import type { RelayRecord } from 'nostr-tools/relay';
	import { _ } from 'svelte-i18n';

	let {
		loginPubkey,
		query,
		urlSearchParams,
		lang,
		isEnabledDarkMode,
		isEnabledRelativeTime,
		isEnabledSkipKind1,
		isEnabledUseClientTag,
		isEnabledOutboxModel,
		isEnabledEventProtection,
		relaysSelected,
		uploaderSelected,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		mutedHashTags,
		followingPubkeys,
		nowRealtime
	}: {
		loginPubkey: string | undefined;
		query: string | undefined;
		urlSearchParams: URLSearchParams;
		lang: string;
		isEnabledDarkMode: boolean;
		isEnabledRelativeTime: boolean;
		isEnabledSkipKind1: boolean;
		isEnabledUseClientTag: boolean;
		isEnabledOutboxModel: boolean;
		isEnabledEventProtection: boolean;
		relaysSelected: string;
		uploaderSelected: string;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashTags: string[];
		followingPubkeys: string[];
		nowRealtime: number;
	} = $props();

	const relaysToUse: RelayRecord = $derived(getRelaysToUse());
	const relaySets: NostrEvent[] = $derived(getRelaySets());
</script>

<Header
	{loginPubkey}
	currentProfilePointer={undefined}
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
<main class="SettingsView View">
	<div class="Layout">
		<div class="Column Column--left">
			<div class="Card">
				<div class="Card__head">
					<h3 class="Card__title">
						<i class="fa-fw fas fa-cog"></i>
						{$_('Settings.menu.settings')}
					</h3>
				</div>
				<div class="Card__body Card__body--nopad">
					<ul class="Settings__groupList">
						<li title={$_('Settings.menu.account')} class="Settings__groupListItem current">
							<span><i class="fa-fw fas fa-user-circle"></i> {$_('Settings.menu.account')}</span>
						</li>
						<li title={$_('Settings.menu.safety')} class="Settings__groupListItem">
							<span><i class="fa-fw fas fa-user-shield"></i> {$_('Settings.menu.safety')}</span>
						</li>
						<li title={$_('Settings.menu.logout')} class="Settings__groupListItem">
							<span><i class="fa-fw fas fa-sign-out-alt"></i> {$_('Settings.menu.logout')}</span>
						</li>
					</ul>
				</div>
			</div>
		</div>
		<div class="Column Column--main">
			<div class="Settings__groups">
				<div data-settings-group="account" class="Card Settings">
					<div class="Settings__head">
						<div class="Settings__info">
							<h1 class="Settings__title">
								<i class="fa-fw fas fa-user-circle"></i>
								{$_('Settings.menu.account')}
							</h1>
						</div>
					</div>
					<div class="Settings__body">
						<div class="Settings__section">
							<div class="Label">
								<span>{$_('Settings.account.profile')}</span>
								<a
									href={urlToLinkProfileEditor}
									target="_blank"
									rel="noreferrer"
									aria-label={$_('Settings.account.profile-edit')}
									title={$_('Settings.account.profile-edit')}><i class="far fa-edit"></i></a
								>
							</div>
							<div class="Control">
								{#if loginPubkey !== undefined}
									<Profile
										{loginPubkey}
										currentPubkey={loginPubkey}
										{profileMap}
										channelMap={new Map<string, ChannelContent>()}
										eventsTimeline={[]}
										eventsReaction={[]}
										eventsEmojiSet={[]}
										{followingPubkeys}
										{mutedPubkeys}
										{mutedChannelIds}
										{mutedWords}
										{mutedHashTags}
									/>
								{/if}
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.language')}</span></div>
							<div class="Control">
								<input
									type="radio"
									id="language-ja"
									name="language"
									value="ja"
									disabled={loginPubkey === undefined}
									bind:group={lang}
									onchange={() => {
										setLang(lang);
									}}
								/>
								<label for="language-ja">日本語</label>
								<input
									type="radio"
									id="language-en"
									name="language"
									value="en"
									disabled={loginPubkey === undefined}
									bind:group={lang}
									onchange={() => {
										setLang(lang);
									}}
								/>
								<label for="language-en">English</label>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.darkmode')}</span></div>
							<div class="Control">
								<label class="SliderSwitch"
									><input
										name="ui_theme"
										type="checkbox"
										disabled={loginPubkey === undefined}
										bind:checked={isEnabledDarkMode}
										onchange={() => {
											setIsEnabledDarkMode(isEnabledDarkMode);
										}}
									/><span class="Slider Round"></span></label
								>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.relative-time')}</span></div>
							<div class="Control">
								<label class="SliderSwitch"
									><input
										name="ui_theme"
										type="checkbox"
										disabled={loginPubkey === undefined}
										bind:checked={isEnabledRelativeTime}
										onchange={() => {
											setIsEnabledRelativeTime(isEnabledRelativeTime);
										}}
									/><span class="Slider Round"></span></label
								>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.skip-kind-1')}</span></div>
							<div class="Control">
								<label class="SliderSwitch"
									><input
										name="ui_theme"
										type="checkbox"
										disabled={loginPubkey === undefined}
										bind:checked={isEnabledSkipKind1}
										onchange={() => {
											setIsEnabledSkipKind1(isEnabledSkipKind1);
											clearCache();
											goto(location.href);
										}}
									/><span class="Slider Round"></span></label
								>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.client-tag')}</span></div>
							<div class="Control">
								<label class="SliderSwitch"
									><input
										name="ui_theme"
										type="checkbox"
										disabled={loginPubkey === undefined}
										bind:checked={isEnabledUseClientTag}
										onchange={() => {
											setIsEnabledUseClientTag(isEnabledUseClientTag);
										}}
									/><span class="Slider Round"></span></label
								>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.outbox-model')}</span></div>
							<div class="Control">
								<label class="SliderSwitch"
									><input
										name="ui_theme"
										type="checkbox"
										disabled={loginPubkey === undefined}
										bind:checked={isEnabledOutboxModel}
										onchange={() => {
											setIsEnabledOutboxModel(isEnabledOutboxModel);
											clearCache();
											goto(location.href);
										}}
									/><span class="Slider Round"></span></label
								>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.event-protection')}</span></div>
							<div class="Control">
								<label class="SliderSwitch"
									><input
										name="ui_theme"
										type="checkbox"
										disabled={loginPubkey === undefined}
										bind:checked={isEnabledEventProtection}
										onchange={() => {
											setIsEnabledEventProtection(isEnabledEventProtection);
										}}
									/><span class="Slider Round"></span></label
								>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.relays')}</span></div>
							<div class="Control">
								<label for="select-relay-list">{$_('Settings.account.select-relay-set')}: </label>
								<select
									id="select-relay-list"
									bind:value={relaysSelected}
									onchange={async () => {
										setRelaysSelected(relaysSelected);
										await setRelaysToUseSelected(relaysSelected);
										clearCache();
										goto(location.href);
									}}
								>
									{#if loginPubkey !== undefined}
										<option value="kind10002">kind 10002</option>
										{#if relaySets.length > 0}
											<optgroup label="kind 30002">
												{#each relaySets as relaySet (relaySet.id)}
													{@const dTag =
														relaySet.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ??
														''}
													<option value={`${relaySet.kind}:${relaySet.pubkey}:${dTag}`}
														>{dTag}</option
													>
												{/each}
											</optgroup>
										{/if}
									{/if}
									<option value="default">Default</option>
								</select>
								<RelayList {relaysToUse} showIcon={true} />
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.uploader')}</span></div>
							<div class="Control">
								<label for="select-uploader">{$_('Settings.account.select-uploader')}: </label>
								<select
									id="select-uploader"
									bind:value={uploaderSelected}
									onchange={() => {
										setUploaderSelected(uploaderSelected);
									}}
								>
									{#each uploaderURLs as uploader (uploader)}
										<option value={uploader}>{uploader}</option>
									{/each}
								</select>
							</div>
						</div>
					</div>
				</div>
				<div data-settings-group="safety" class="Card Settings">
					<div class="Settings__head">
						<div class="Settings__info">
							<h1 class="Settings__title">
								<i class="fa-fw fas fa-user-shield"></i>
								{$_('Settings.menu.safety')}
							</h1>
						</div>
					</div>
					<div class="Settings__body">
						<MuteList
							{loginPubkey}
							{profileMap}
							{channelMap}
							{mutedPubkeys}
							{mutedChannelIds}
							{mutedWords}
							{mutedHashTags}
							isAuthor={true}
						/>
					</div>
				</div>
				<div data-settings-group="logout" class="Card Settings">
					<div class="Settings__head">
						<div class="Settings__info">
							<h1 class="Settings__title">
								<i class="fa-fw fas fa-sign-out-alt"></i>
								{$_('Settings.menu.logout')}
							</h1>
						</div>
					</div>
					<div class="Settings__body">
						<div class="Settings__section">
							<div class="Control">
								<button
									disabled={loginPubkey === undefined}
									onclick={() => {
										document.dispatchEvent(new Event('nlLogout'));
									}}
									class="Button Button--warn"><span>{$_('Settings.menu.logout')}</span></button
								>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</main>

<style>
	.Control input:disabled,
	.Control input:disabled + span {
		cursor: not-allowed;
	}
</style>
