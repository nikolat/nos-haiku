<script lang="ts">
	import {
		defaultKindsSelected,
		uploaderURLs,
		urlToLinkProfileEditor,
		urlToLinkRelayEditor
	} from '$lib/config';
	import {
		getNameOfKind,
		getRelaysToUseFromKind10002Event,
		type ChannelContent,
		type ProfileContentEvent
	} from '$lib/utils';
	import type { RelayConnector } from '$lib/resource';
	import Profile from '$lib/components/kinds/Profile.svelte';
	import MuteList from '$lib/components/kinds/MuteList.svelte';
	import RelayList from '$lib/components/kinds/RelayList.svelte';
	import Header from '$lib/components/Header.svelte';
	import type { NostrEvent } from 'nostr-tools/pure';
	import { _ } from 'svelte-i18n';

	let {
		rc,
		loginPubkey,
		eventsMention,
		eventFollowList,
		readTimeOfNotification,
		query,
		urlSearchParams,
		lang,
		setLang,
		isEnabledDarkMode,
		setIsEnabledDarkMode,
		isEnabledRelativeTime,
		setIsEnabledRelativeTime,
		isEnabledUseClientTag,
		setIsEnabledUseClientTag,
		isEnabledEventProtection,
		setIsEnabledEventProtection,
		eventMuteList,
		eventRelayList,
		uploaderSelected,
		setUploaderSelected,
		kindsSelected,
		setKindsSelected,
		eventsBadge,
		eventsPoll,
		eventsQuoted,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		mutedHashtags,
		followingPubkeys,
		nowRealtime
	}: {
		rc: RelayConnector | undefined;
		loginPubkey: string | undefined;
		eventsMention: NostrEvent[];
		eventFollowList: NostrEvent | undefined;
		readTimeOfNotification: number;
		query: string | undefined;
		urlSearchParams: URLSearchParams;
		lang: string;
		setLang: (value: string) => void;
		isEnabledDarkMode: boolean;
		setIsEnabledDarkMode: (value: boolean) => void;
		isEnabledRelativeTime: boolean;
		setIsEnabledRelativeTime: (value: boolean) => void;
		isEnabledUseClientTag: boolean;
		setIsEnabledUseClientTag: (value: boolean) => void;
		isEnabledEventProtection: boolean;
		setIsEnabledEventProtection: (value: boolean) => void;
		eventMuteList: NostrEvent | undefined;
		eventRelayList: NostrEvent | undefined;
		uploaderSelected: string;
		setUploaderSelected: (value: string) => void;
		kindsSelected: number[];
		setKindsSelected: (value: number[]) => void;
		eventsBadge: NostrEvent[];
		eventsPoll: NostrEvent[];
		eventsQuoted: NostrEvent[];
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		mutedHashtags: string[];
		followingPubkeys: string[];
		nowRealtime: number;
	} = $props();

	const isTooManyRelays = (eventRelayList: NostrEvent | undefined): boolean => {
		const limit: number = 4;
		let readCount: number = 0;
		let writeCount: number = 0;
		const relayRecord = getRelaysToUseFromKind10002Event(eventRelayList);
		for (const r of Object.entries(relayRecord)) {
			if (r[1].read) {
				readCount++;
			}
			if (r[1].write) {
				writeCount++;
			}
		}
		return readCount > limit || writeCount > limit;
	};
</script>

<Header
	{rc}
	{loginPubkey}
	{eventsMention}
	{eventFollowList}
	{readTimeOfNotification}
	currentProfilePointer={undefined}
	{query}
	{urlSearchParams}
	{profileMap}
	{mutedPubkeys}
	{mutedWords}
	{mutedHashtags}
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
										{rc}
										{loginPubkey}
										currentPubkey={loginPubkey}
										{profileMap}
										channelMap={new Map<string, ChannelContent>()}
										eventsTimeline={[]}
										{eventsBadge}
										{eventsPoll}
										{eventsQuoted}
										eventsReaction={[]}
										eventsEmojiSet={[]}
										eventsChannelBookmark={[]}
										{followingPubkeys}
										{mutedPubkeys}
										{mutedChannelIds}
										{mutedWords}
										{mutedHashtags}
										eventFollowList={undefined}
										eventEmojiSetList={undefined}
										{eventMuteList}
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
							<div class="Label">
								<span>{$_('Settings.account.relays')}</span>
								<a
									href={urlToLinkRelayEditor}
									target="_blank"
									rel="noreferrer"
									aria-label={$_('Settings.account.relays-edit')}
									title={$_('Settings.account.relays-edit')}><i class="far fa-edit"></i></a
								>
							</div>
							<div class="Control">
								{#if isTooManyRelays(eventRelayList)}
									<span class="relays-warning">⚠️{$_('Settings.account.too-many-relays')}</span>
								{/if}
								<RelayList
									relaysToUse={getRelaysToUseFromKind10002Event(eventRelayList)}
									showIcon={true}
								/>
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
						<div class="Settings__section">
							<div class="Label"><span>{$_('Settings.account.kinds')}</span></div>
							<div class="Control">
								<ul>
									{#each defaultKindsSelected as kind (kind)}
										{@const isSelected = kindsSelected.includes(kind)}
										<li>
											<input
												name="kinds"
												type="checkbox"
												disabled={loginPubkey === undefined}
												checked={isSelected}
												onchange={() => {
													let newKindsSelected: number[] = [];
													if (kindsSelected.includes(kind)) {
														newKindsSelected = kindsSelected.filter((k) => k !== kind);
													} else {
														newKindsSelected = [...kindsSelected, kind].toSorted();
													}
													setKindsSelected(newKindsSelected);
												}}
											/>
											kind:{kind} ({getNameOfKind(kind)})
										</li>
									{/each}
								</ul>
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
							{rc}
							{loginPubkey}
							{profileMap}
							{channelMap}
							{mutedPubkeys}
							{mutedChannelIds}
							{mutedWords}
							{mutedHashtags}
							{eventMuteList}
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
