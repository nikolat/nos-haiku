<script lang="ts">
	import { getRoboHashURL, uploaderURLs, urlToLinkProfileEditor } from '$lib/config';
	import type { ChannelContent, ProfileContentEvent } from '$lib/utils';
	import {
		clearCache,
		getRelaySets,
		getRelaysToUse,
		setIsEnabledDarkMode,
		setIsEnabledRelativeTime,
		setIsEnabledSkipKind1,
		setIsEnabledUseClientTag,
		setLang,
		setRelaysSelected,
		setRelaysToUseSelected,
		setUploaderSelected,
		unmuteChannel,
		unmuteHashTag,
		unmuteUser,
		unmuteWord
	} from '$lib/resource.svelte';
	import Header from '$lib/components/Header.svelte';
	import Profile from '$lib/components/Profile.svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { NostrEvent } from 'nostr-tools/pure';
	import type { RelayRecord } from 'nostr-tools/relay';
	import * as nip11 from 'nostr-tools/nip11';
	import * as nip19 from 'nostr-tools/nip19';
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

	const mutedChannels: ChannelContent[] = $derived(
		mutedChannelIds.map((id) => channelMap.get(id)).filter((cc) => cc !== undefined)
	);
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
										profileEventMap={new Map<string, NostrEvent>()}
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
										<option value="nip07">NIP-07</option>
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
								<table>
									<tbody>
										<tr>
											<th></th>
											<th>relay</th>
											<th>r</th>
											<th>w</th>
										</tr>
										{#each Object.entries(relaysToUse) as relay (relay[0])}
											<tr>
												<td>
													{#if browser}
														{#await nip11.fetchRelayInformation(relay[0]) then r}
															{#if URL.canParse(r.icon ?? '')}
																<img src={r.icon} alt={r.name} />
															{:else if r.pubkey !== undefined}
																<img
																	src={getRoboHashURL(nip19.npubEncode(r.pubkey))}
																	alt={r.name}
																/>
															{/if}
														{:catch error}
															{console.warn(error.message)}
														{/await}
													{/if}
												</td>
												<td>{relay[0]}</td>
												<td
													><input
														type="checkbox"
														checked={relay[1].read}
														name="read"
														disabled
													/></td
												>
												<td
													><input
														type="checkbox"
														checked={relay[1].write}
														name="write"
														disabled
													/></td
												>
											</tr>
										{/each}
									</tbody>
								</table>
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
						<div class="Settings__section">
							<div class="Label">
								<i class="fa-fw fas fa-user-minus"></i>
								<span>{$_('Settings.safety.muted-users')}</span>
								<p class="Tip">{$_('Settings.safety.muted-users-tips')}</p>
							</div>
							<div class="Control">
								<div class="BlockList">
									<div class="BlockList__container">
										<ul>
											{#each mutedPubkeys as pubkey (pubkey)}
												{@const prof = profileMap.get(pubkey)}
												<li style="">
													<div>
														<a href="/{nip19.npubEncode(pubkey)}"
															><img
																alt=""
																src={profileMap.get(pubkey)?.picture ??
																	getRoboHashURL(nip19.npubEncode(pubkey))}
															/></a
														>
													</div>
													<div>
														<p>{prof?.display_name ?? ''} (id:{prof?.name ?? ''})</p>
													</div>
													<div>
														<button
															class="Button Button--warn"
															aria-label={$_('Settings.safety.unmute')}
															onclick={() => {
																if (loginPubkey !== undefined) {
																	unmuteUser(pubkey, loginPubkey);
																}
															}}><i class="fa-fw fas fa-trash-alt"></i></button
														>
													</div>
												</li>
											{:else}
												<li>{$_('Settings.safety.nothing-muted')}</li>
											{/each}
										</ul>
									</div>
								</div>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label">
								<i class="fa-fw fas fa-tags"></i>
								<span>{$_('Settings.safety.muted-keywords')}</span>
								<p class="Tip">{$_('Settings.safety.muted-keywords-tips')}</p>
							</div>
							<div class="Control">
								<div class="BlockList">
									<div class="BlockList__container">
										<ul>
											{#each mutedChannels as channel (channel.id)}
												<li>
													<div>
														<a href="/keyword/{nip19.neventEncode({ id: channel.id })}">
															<img
																alt=""
																src={URL.canParse(channel.picture ?? '')
																	? channel.picture
																	: getRoboHashURL(nip19.neventEncode({ id: channel.id }))}
															/>
														</a>
													</div>
													<div>
														<p>{channel.name}</p>
													</div>
													<div>
														<button
															class="Button Button--warn"
															aria-label={$_('Settings.safety.unmute')}
															onclick={() => {
																if (loginPubkey !== undefined) {
																	unmuteChannel(channel.id, loginPubkey);
																}
															}}><i class="fa-fw fas fa-trash-alt"></i></button
														>
													</div>
												</li>
											{:else}
												<li>{$_('Settings.safety.nothing-muted')}</li>
											{/each}
										</ul>
									</div>
								</div>
							</div>
						</div>
						{#if mutedWords.length > 0}
							<div class="Settings__section">
								<div class="Label">
									<i class="fa-fw fas fa-tags"></i> <span>{$_('Settings.safety.muted-words')}</span>
									<p class="Tip">{$_('Settings.safety.muted-words-tips')}</p>
								</div>
								<div class="Control">
									<div class="BlockList">
										<div class="BlockList__container">
											<ul>
												{#each mutedWords as word (word)}
													<li>
														<div>
															<p>{word}</p>
														</div>
														<div>
															<button
																class="Button Button--warn"
																aria-label={$_('Settings.safety.unmute')}
																onclick={() => {
																	if (loginPubkey !== undefined) {
																		unmuteWord(word, loginPubkey);
																	}
																}}><i class="fa-fw fas fa-trash-alt"></i></button
															>
														</div>
													</li>
												{/each}
											</ul>
										</div>
									</div>
								</div>
							</div>
						{/if}
						{#if mutedHashTags.length > 0}
							<div class="Settings__section">
								<div class="Label">
									<i class="fa-fw fas fa-tags"></i>
									<span>{$_('Settings.safety.muted-hashtags')}</span>
									<p class="Tip">{$_('Settings.safety.muted-hashtags-tips')}</p>
								</div>
								<div class="Control">
									<div class="BlockList">
										<div class="BlockList__container">
											<ul>
												{#each mutedHashTags as hashTag (hashTag)}
													<li>
														<div>
															<p>#{hashTag}</p>
														</div>
														<div>
															<button
																class="Button Button--warn"
																aria-label={$_('Settings.safety.unmute')}
																onclick={() => {
																	if (loginPubkey !== undefined) {
																		unmuteHashTag(hashTag, loginPubkey);
																	}
																}}><i class="fa-fw fas fa-trash-alt"></i></button
															>
														</div>
													</li>
												{/each}
											</ul>
										</div>
									</div>
								</div>
							</div>
						{/if}
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
	.Control table {
		table-layout: auto;
		width: auto;
	}
	.Control table th {
		text-align: center;
		padding: 1px 1em;
		background-color: var(--background-secondary);
	}
	.Control table td {
		white-space: pre-wrap;
		padding: 1px 1em;
	}
	.Control table tr:nth-child(odd) td {
		background-color: var(--background-secondary);
	}
	.Control table td img {
		width: 16px;
		height: 16px;
	}
</style>
