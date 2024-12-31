<script lang="ts">
	import { getRoboHashURL, uploaderURLs, urlToLinkProfileEditor } from '$lib/config';
	import type { ChannelContent, ProfileContentEvent } from '$lib/utils';
	import {
		clearCache,
		getRelaysToUse,
		setIsEnabledDarkMode,
		setIsEnabledSkipKind1,
		setRelaysSelected,
		setRelaysToUseSelected,
		setUploaderSelected,
		unmuteChannel,
		unmuteUser
	} from '$lib/resource.svelte';
	import Header from '$lib/components/Header.svelte';
	import Profile from '$lib/components/Profile.svelte';
	import { goto } from '$app/navigation';
	import type { NostrEvent } from 'nostr-tools/pure';
	import type { RelayRecord } from 'nostr-tools/relay';
	import * as nip11 from 'nostr-tools/nip11';
	import * as nip19 from 'nostr-tools/nip19';

	let {
		loginPubkey,
		isEnabledDarkMode,
		isEnabledSkipKind1,
		relaysSelected,
		uploaderSelected,
		profileMap,
		channelMap,
		mutedPubkeys,
		mutedChannelIds,
		mutedWords,
		followingPubkeys,
		nowRealtime
	}: {
		loginPubkey: string | undefined;
		isEnabledDarkMode: boolean;
		isEnabledSkipKind1: boolean;
		relaysSelected: string;
		uploaderSelected: string;
		profileMap: Map<string, ProfileContentEvent>;
		channelMap: Map<string, ChannelContent>;
		mutedPubkeys: string[];
		mutedChannelIds: string[];
		mutedWords: string[];
		followingPubkeys: string[];
		nowRealtime: number;
	} = $props();

	const relaysToUse: RelayRecord = $derived(getRelaysToUse());

	const mutedChannels: ChannelContent[] = $derived(
		mutedChannelIds.map((id) => channelMap.get(id)).filter((cc) => cc !== undefined)
	);
</script>

<Header {loginPubkey} {profileMap} {mutedPubkeys} {nowRealtime} />
<main class="SettingsView View">
	<div class="Layout">
		<div class="Column Column--left">
			<div class="Card">
				<div class="Card__head">
					<h3 class="Card__title"><i class="fa-fw fas fa-cog"></i> 設定</h3>
				</div>
				<div class="Card__body Card__body--nopad">
					<ul class="Settings__groupList">
						<li title="アカウント" class="Settings__groupListItem current">
							<span><i class="fa-fw fas fa-user-circle"></i> アカウント</span>
						</li>
						<li title="安全" class="Settings__groupListItem">
							<span><i class="fa-fw fas fa-user-shield"></i> 安全</span>
						</li>
						<li title="ログアウト" class="Settings__groupListItem">
							<span><i class="fa-fw fas fa-sign-out-alt"></i> ログアウト</span>
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
							<h1 class="Settings__title"><i class="fa-fw fas fa-user-circle"></i> アカウント</h1>
						</div>
					</div>
					<div class="Settings__body">
						<div class="Settings__section">
							<div class="Label">
								<span>プロフィール</span>
								<a
									href={urlToLinkProfileEditor}
									target="_blank"
									rel="noreferrer"
									aria-label="プロフィールを編集する"
									title="プロフィールを編集する"><i class="far fa-edit"></i></a
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
										{followingPubkeys}
										{mutedPubkeys}
										{mutedChannelIds}
										{mutedWords}
									/>
								{/if}
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label"><span>ダークモード</span></div>
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
							<div class="Label"><span>kind:1 をスキップ</span></div>
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
							<div class="Label"><span>接続リレー</span></div>
							<div class="Control">
								<label for="select-relay-list">Select Relay List: </label>
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
										<option value="kind10002">Kind 10002</option>
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
													{#await nip11.fetchRelayInformation(relay[0]) then r}
														{#if URL.canParse(r.icon ?? '')}
															<img src={r.icon} alt={r.name} />
														{:else if r.pubkey !== undefined}
															<img src={getRoboHashURL(nip19.npubEncode(r.pubkey))} alt={r.name} />
														{/if}
													{:catch error}
														{console.warn(error.message)}
													{/await}
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
							<div class="Label"><span>アップローダー選択</span></div>
							<div class="Control">
								<label for="select-uploader">Select Uploader: </label>
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
							<h1 class="Settings__title"><i class="fa-fw fas fa-user-shield"></i> 安全</h1>
						</div>
					</div>
					<div class="Settings__body">
						<div class="Settings__section">
							<div class="Label">
								<i class="fa-fw fas fa-user-minus"></i> <span>ミュート中のユーザー</span>
								<p class="Tip">
									ミュートされたユーザーは最新のタイムラインから除外されます。ただし、直接ユーザーのページを開くと見ることができます。
								</p>
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
															aria-label="ミュート解除"
															onclick={() => {
																if (loginPubkey !== undefined) {
																	unmuteUser(pubkey, loginPubkey);
																}
															}}><i class="fa-fw fas fa-trash-alt"></i></button
														>
													</div>
												</li>
											{/each}
											{#if mutedPubkeys.length === 0}
												<li>ミュートしていません</li>
											{/if}
										</ul>
									</div>
								</div>
							</div>
						</div>
						<div class="Settings__section">
							<div class="Label">
								<i class="fa-fw fas fa-tags"></i> <span>ミュート中のキーワード</span>
								<p class="Tip">ミュートされたキーワードは最新のタイムラインから除外されます。</p>
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
															aria-label="ミュート解除"
															onclick={() => {
																if (loginPubkey !== undefined) {
																	unmuteChannel(channel.id, loginPubkey);
																}
															}}><i class="fa-fw fas fa-trash-alt"></i></button
														>
													</div>
												</li>
											{/each}
											{#if mutedChannels.length === 0}
												<li>ミュートしていません</li>
											{/if}
										</ul>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
				<div data-settings-group="logout" class="Card Settings">
					<div class="Settings__head">
						<div class="Settings__info">
							<h1 class="Settings__title"><i class="fa-fw fas fa-sign-out-alt"></i> ログアウト</h1>
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
									class="Button Button--warn"><span>ログアウト</span></button
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
