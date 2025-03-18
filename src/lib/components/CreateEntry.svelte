<script lang="ts">
	import { defaultAccountUri, getRoboHashURL } from '$lib/config';
	import { getEmoji, getEmojiMap, type ChannelContent } from '$lib/utils';
	import { getChannelEventMap, getProfileName, makeEvent, sendNote } from '$lib/resource.svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { EventTemplate, NostrEvent, UnsignedEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		readServerConfig,
		uploadFile,
		type DelayedProcessingResponse,
		type FileUploadResponse,
		type OptionalFormDataFields
	} from 'nostr-tools/nip96';
	import { getToken } from 'nostr-tools/nip98';
	import { unixNow, type ProfileContent } from 'applesauce-core/helpers';
	import { _ } from 'svelte-i18n';
	import { browser } from '$app/environment';

	let {
		loginPubkey,
		currentChannelId,
		eventToReply,
		isTopPage,
		profileMap,
		uploaderSelected,
		eventsEmojiSet,
		channelToPost = $bindable(),
		showForm = $bindable(),
		previewEvent = $bindable(),
		callInsertText = $bindable(),
		baseEventToEdit = $bindable()
	}: {
		loginPubkey: string | undefined;
		currentChannelId?: string | undefined;
		eventToReply?: NostrEvent;
		isTopPage: boolean;
		profileMap: Map<string, ProfileContent>;
		uploaderSelected: string;
		eventsEmojiSet: NostrEvent[];
		channelToPost: ChannelContent | undefined;
		showForm: boolean;
		previewEvent: UnsignedEvent | undefined;
		callInsertText: (word: string) => void;
		baseEventToEdit: NostrEvent | undefined;
	} = $props();

	let pubkeysExcluded: string[] = $state([]);
	let filesToUpload: FileList | undefined = $state();
	let imetaMap: Map<string, FileUploadResponse> = new Map<string, FileUploadResponse>();
	let inputFile: HTMLInputElement;
	let textArea: HTMLTextAreaElement;

	const emojiMap: Map<string, string> = $derived(getEmojiMap(eventsEmojiSet));

	let emojiPickerContainer: HTMLElement | undefined = $state();
	const callGetEmoji = async () => {
		if (emojiPickerContainer === undefined) {
			return;
		}
		const r = await getEmoji(emojiPickerContainer, $state.snapshot(emojiMap));
		if (r === null) {
			return;
		}
		insertText(r.emojiStr);
	};

	let isInProcess: boolean = $state(false);

	const uploadFileExec = async () => {
		if (filesToUpload === undefined || filesToUpload.length === 0) {
			return;
		}
		const nostr = window.nostr;
		if (nostr === undefined) {
			return;
		}
		isInProcess = true;
		const sign = (e: EventTemplate) => nostr.signEvent(e);
		const config = await readServerConfig(uploaderSelected);
		const token = await getToken(config.api_url, 'POST', sign, true);
		let file: File | undefined;
		for (const f of filesToUpload ?? []) {
			file = f;
		}
		if (file === undefined) {
			isInProcess = false;
			return;
		}
		const option: OptionalFormDataFields = {
			size: String(file.size),
			content_type: file.type
		};
		console.info('file uploading...');
		const fileUploadResponse: FileUploadResponse = await uploadFile(
			file,
			config.api_url,
			token,
			option
		);
		if (fileUploadResponse.status === 'error') {
			console.warn(fileUploadResponse.message);
			isInProcess = false;
			return;
		}
		if (fileUploadResponse.status === 'processing') {
			console.info(fileUploadResponse.message);
			const processing_url = fileUploadResponse.processing_url;
			if (processing_url === undefined) {
				isInProcess = false;
				return;
			}
			const request = new Request(processing_url);
			const sleep = (timeout: number) => new Promise((handler) => setTimeout(handler, timeout));
			let retry: number = 5;
			while (true) {
				const response = await fetch(request);
				if (response.status === 201) {
					break;
				}
				const delayedProcessingResponse: DelayedProcessingResponse = await response.json();
				if (delayedProcessingResponse.status === 'error') {
					console.warn(delayedProcessingResponse.message);
					isInProcess = false;
					return;
				}
				console.info(delayedProcessingResponse);
				retry--;
				if (retry < 0) {
					console.warn('timeout');
					isInProcess = false;
					return;
				}
				await sleep(1000);
			}
		}
		console.info('file uploading complete');
		isInProcess = false;
		const uploadedFileUrl = fileUploadResponse.nip94_event?.tags
			.find((tag) => tag[0] === 'url')
			?.at(1);
		if (uploadedFileUrl === undefined || !URL.canParse(uploadedFileUrl)) {
			return;
		}
		imetaMap.set(uploadedFileUrl, fileUploadResponse);
		insertText(uploadedFileUrl);
	};

	const insertText = (word: string): void => {
		let sentence = textArea.value;
		const len = sentence.length;
		const pos = textArea.selectionStart;
		const before = sentence.slice(0, pos);
		const after = sentence.slice(pos, pos + len);
		if (!(before.length === 0 || before.endsWith('\n'))) {
			word = `\n${word}`;
		}
		sentence = before + word + after;
		textArea.value = sentence;
		textArea.focus();
		textArea.selectionStart = pos + word.length;
		textArea.selectionEnd = pos + word.length;
		contentToSend = sentence;
	};

	let channelNameToCreate: string = $state('');
	let addContentWarning: boolean = $state(false);
	let reasonContentWarning: string = $state('');
	let addPoll: boolean = $state(false);
	let pollItems: string[] = $state([]);
	let pollPeriod: number = $state(1 * 24 * 60 * 60);
	let pollType: 'singlechoice' | 'multiplechoice' = $state('singlechoice');
	let contentToSend: string = $state('');
	$effect(() => {
		if (baseEventToEdit !== undefined) {
			channelNameToCreate = `kind:${baseEventToEdit.kind}`;
			if (baseEventToEdit.kind === 10001) {
				const nevents: string[] = baseEventToEdit.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 'e')
					.map((tag) => `nostr:${nip19.neventEncode({ id: tag[1] })}`);
				contentToSend = nevents.join('\n');
			}
			channelToPost = undefined;
			return;
		} else {
			channelNameToCreate = '';
		}
		if (channelToPost?.name !== undefined) {
			channelNameToCreate = channelToPost.name;
		} else {
			channelNameToCreate = '';
		}
	});

	const previewEvents = $derived.by(() => {
		const targetEventToReply =
			channelToPost?.eventkind40 ??
			eventToReply ??
			(currentChannelId !== undefined ? getChannelEventMap().get(currentChannelId) : undefined);
		const contentWarningReason = addContentWarning
			? reasonContentWarning.length > 0
				? reasonContentWarning
				: null
			: undefined;
		return makeEvent(
			loginPubkey ?? '',
			contentToSend,
			addPoll ? '' : channelNameToCreate,
			[], //除外をプレビューに反映させると選択できなくなってしまう
			addPoll ? undefined : targetEventToReply,
			emojiMap,
			imetaMap,
			contentWarningReason,
			addPoll ? pollItems.filter((item) => item.length > 0) : undefined,
			addPoll ? unixNow() + pollPeriod : undefined,
			addPoll ? pollType : undefined,
			baseEventToEdit?.kind
		);
	});
	const canSendNote: boolean = $derived(
		!(
			contentToSend.length === 0 ||
			(!addPoll && channelNameToCreate.length === 0 && isTopPage) ||
			(addPoll && pollItems.filter((item) => item.length > 0).length < 2)
		)
	);
	$effect(() => {
		if (canSendNote) {
			previewEvent = previewEvents.eventToSend;
		} else {
			previewEvent = undefined;
		}
	});

	const callSendNote = () => {
		if (loginPubkey === undefined || !canSendNote) {
			return;
		}
		const targetEventToReply =
			channelToPost?.eventkind40 ??
			eventToReply ??
			(currentChannelId !== undefined ? getChannelEventMap().get(currentChannelId) : undefined);
		const contentWarningReason = addContentWarning
			? reasonContentWarning.length > 0
				? reasonContentWarning
				: null
			: undefined;
		sendNote(
			loginPubkey,
			contentToSend,
			addPoll ? '' : channelNameToCreate,
			pubkeysExcluded,
			addPoll ? undefined : targetEventToReply,
			emojiMap,
			imetaMap,
			contentWarningReason,
			addPoll ? pollItems.filter((item) => item.length > 0) : undefined,
			addPoll ? unixNow() + pollPeriod : undefined,
			addPoll ? pollType : undefined,
			baseEventToEdit?.kind
		).then((event: NostrEvent | null) => {
			const isNeededShowEvent: boolean = isTopPage && addPoll;
			contentToSend = '';
			channelToPost = undefined;
			channelNameToCreate = '';
			addContentWarning = false;
			reasonContentWarning = '';
			addPoll = false;
			pollItems = [];
			pollPeriod = 1 * 24 * 60 * 60;
			filesToUpload = undefined;
			showForm = false;
			previewEvent = undefined;
			if (isNeededShowEvent && event !== null) {
				const nevent: string = nip19.neventEncode({ ...event, author: event.pubkey });
				goto(`/entry/${nevent}`);
			}
		});
	};

	const pubkeysMentioningTo = $derived(
		previewEvent?.tags.filter((tag) => tag.length >= 2 && tag[0] === 'p').map((tag) => tag[1]) ?? []
	);

	onMount(() => {
		callInsertText = insertText;
	});
	beforeNavigate(() => {
		pubkeysExcluded = [];
		filesToUpload = undefined;
		channelNameToCreate = '';
		addContentWarning = false;
		reasonContentWarning = '';
		addPoll = false;
		pollItems = [];
		pollPeriod = 1 * 24 * 60 * 60;
		pollType = 'singlechoice';
		contentToSend = '';
	});
</script>

<div class="CreateEntry">
	{#if browser}
		<a
			href="/{loginPubkey === undefined ? '' : nip19.npubEncode(loginPubkey)}"
			class="CreateEntry__profile"
			><img
				src={loginPubkey === undefined
					? defaultAccountUri
					: (profileMap.get(loginPubkey)?.picture ?? getRoboHashURL(nip19.npubEncode(loginPubkey)))}
				class="Avatar"
				alt=""
			/></a
		>
	{/if}
	<div class="CreateEntry__main">
		<div class="InputGroup">
			{#if currentChannelId === undefined && eventToReply === undefined && !addPoll}
				<div class="vue-simple-suggest Input CreateEntry__keyword">
					<div
						aria-haspopup="listbox"
						aria-owns="19-suggestions"
						aria-expanded="false"
						class="input-wrapper"
					>
						<input
							placeholder={isTopPage
								? $_('CreateEntry.create-new-keyword')
								: `${$_('CreateEntry.create-new-keyword')} (${$_('CreateEntry.optional')})`}
							disabled={channelToPost !== undefined}
							class={isTopPage && channelNameToCreate.length === 0 && contentToSend.length > 0
								? 'default-input Input empty-channel'
								: 'default-input Input'}
							aria-autocomplete="list"
							aria-controls="19-suggestions"
							bind:value={channelNameToCreate}
						/>
						{#if channelNameToCreate.length > 0}
							{#if baseEventToEdit !== undefined}
								<span class="channel-to-post">⚠️{$_('CreateEntry.edit-mode')}</span>
							{:else if channelToPost !== undefined}
								{@const channel = channelToPost}
								<img
									class="channel-to-post"
									alt=""
									src={URL.canParse(channel.picture ?? '')
										? channel.picture
										: getRoboHashURL(nip19.neventEncode({ id: channel.id }))}
								/>
							{:else}
								<span class="channel-to-post">⚠️{$_('CreateEntry.create-new')}</span>
							{/if}
							<span class="channel-clear">
								<button
									class="channel-clear"
									title="clear the channel"
									onclick={() => {
										channelToPost = undefined;
										channelNameToCreate = '';
										if (baseEventToEdit !== undefined) {
											baseEventToEdit = undefined;
											contentToSend = '';
										}
									}}
									aria-label="clear the channel"
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
							</span>
						{/if}
					</div>
				</div>
			{/if}
			{#if addContentWarning}
				<div class="vue-simple-suggest Input CreateEntry__content_warning CreateEntry__keyword">
					<div class="input-wrapper">
						<input
							placeholder={`${$_('CreateEntry.reason-for-warning')} (${$_('CreateEntry.optional')})`}
							class="default-input-cw Input"
							bind:value={reasonContentWarning}
						/>
					</div>
				</div>
			{/if}
			<div
				class="RichTextEditor CreateEntry__text"
				data-is-active="true"
				data-is-guest-preview-mode="true"
			>
				<div class="RichTextEditor__toolbar ql-toolbar" style="">
					<span class="ql-formats">
						<span class="ql-formats">
							<button
								aria-label={$_('CreateEntry.add-image')}
								title={$_('CreateEntry.add-image')}
								class="ToolbarItem ql-image"
								onclick={() => inputFile.click()}
								disabled={isInProcess}
								type="button"
							>
								<i class="fa-fw far fa-camera"></i>
							</button>
							<input
								class="select-upload-file"
								type="file"
								accept="image/*,video/*,audio/*"
								bind:this={inputFile}
								bind:files={filesToUpload}
								onchange={uploadFileExec}
							/>
							{#if currentChannelId === undefined && eventToReply === undefined}
								<button
									aria-label="poll"
									title="poll"
									class={addPoll ? 'ToolbarItem ql-poll on' : 'ToolbarItem ql-poll'}
									type="button"
									onclick={() => {
										addPoll = !addPoll;
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
											d="M3,3 L21,3 C22.1045695,3 23,3.8954305 23,5 L23,19 C23,20.1045695 22.1045695,21 21,21 L3,21 C1.8954305,21 1,20.1045695 1,19 L1,5 C1,3.8954305 1.8954305,3 3,3 Z M3,5 L3,19 L21,19 L21,5 L3,5 Z M9,17 L7,17 L7,11 L9,11 L9,17 Z M13,17 L11,17 L11,7 L13,7 L13,17 Z M17,17 L15,17 L15,10 L17,10 L17,17 Z"
										/>
									</svg>
								</button>
							{/if}
							<button
								aria-label="Content Warning"
								title="Content Warning"
								class={addContentWarning ? 'ToolbarItem ql-cw on' : 'ToolbarItem ql-cw'}
								type="button"
								onclick={() => {
									addContentWarning = !addContentWarning;
								}}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
									<path
										fill-rule="evenodd"
										d="M15.4362056,3.97761907 L22.4415418,15.9531803 C23.1705647,17.1855523 23.1862871,18.7132183 22.4827809,19.960327 C21.7784409,21.2089137 20.4619131,21.9842458 19.0122617,21.9983464 L4.97439311,21.9982802 C3.53965557,21.9866122 2.22062199,21.2088986 1.51617253,19.9591997 C0.812307653,18.7105379 0.82874719,17.1794759 1.55542122,15.9576183 L8.56335758,3.97766866 C9.27539851,2.75195566 10.5866895,1.99834312 12.0044595,2.00000273 C13.4220774,2.00166216 14.7329114,2.75839786 15.4362056,3.97761907 Z M10.2912062,4.98490751 L3.27807854,16.973689 C2.91426165,17.5854502 2.90603166,18.3519329 3.25843298,18.9770956 C3.61122214,19.6029463 4.27192295,19.9925012 4.98252774,19.9983133 L19.0025048,19.998394 C19.7286764,19.9913068 20.3881019,19.6029566 20.7408294,18.977675 C21.0930548,18.3532834 21.0851837,17.588488 20.7176978,16.9672502 L13.7068317,4.98222313 C13.357551,4.37673307 12.7063962,4.00082577 12.0021183,4.00000136 C11.2977596,3.99917685 10.6463678,4.37353845 10.2912062,4.98490751 Z M12.0003283,17.9983464 C11.4478622,17.9983464 11,17.5506311 11,16.9983464 C11,16.4460616 11.4478622,15.9983464 12.0003283,15.9983464 C12.5527943,15.9983464 13.0006565,16.4460616 13.0006565,16.9983464 C13.0006565,17.5506311 12.5527943,17.9983464 12.0003283,17.9983464 Z M11.0029544,7.99834639 L13.0036109,7.99834639 L13.0036109,14.9983464 L11.0029544,14.9983464 L11.0029544,7.99834639 Z"
									/>
								</svg>
							</button>
							<button
								aria-label={$_('CreateEntry.add-emoji')}
								title={$_('CreateEntry.add-emoji')}
								class="ToolbarItem ql-emoji"
								type="button"
								onclick={callGetEmoji}
							>
								<i class="fa-fw far fa-smile-plus"></i>
							</button>
							{#if pubkeysMentioningTo.length > 0}
								mention to:
								{#each pubkeysMentioningTo as p (p)}
									{@const prof = profileMap.get(p)}
									{@const isExcluded = pubkeysExcluded.includes(p)}
									<button
										class={isExcluded ? 'Button toggle-mention excluded' : 'Button toggle-mention'}
										onclick={() => {
											if (isExcluded) {
												pubkeysExcluded = pubkeysExcluded.filter((pubkey) => pubkey !== p);
											} else {
												pubkeysExcluded.push(p);
											}
										}}
										><img
											src={prof?.picture ?? getRoboHashURL(nip19.npubEncode(p))}
											alt={getProfileName(p)}
											class="Avatar Avatar--sm"
										/></button
									>
								{/each}
							{/if}
						</span>
					</span>
					<div class="emoji-picker-container" bind:this={emojiPickerContainer}></div>
				</div>
				<div translate="no" class="RichTextEditor__editor notranslate ql-container">
					<textarea
						class="ql-editor ql-blank"
						bind:this={textArea}
						bind:value={contentToSend}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
								callSendNote();
							}
						}}
					></textarea>
					<div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>
				</div>
				<input type="file" style="display: none;" />
			</div>
		</div>
		{#if addPoll}
			<div class="vue-simple-suggest CreateEntry__poll">
				<div class="input-wrapper">
					<dl class="poll-settings">
						<dt>{$_('CreateEntry.poll-items')}</dt>
						<dd>
							<ul>
								{#each pollItems.concat('') as item, i (i)}
									{#if item.length > 0 || i === pollItems.length}
										<li>
											<input
												class="RichTextEditor ql-editor"
												type="text"
												placeholder={$_('CreateEntry.poll-item')}
												bind:value={pollItems[i]}
											/>
										</li>
									{/if}
								{/each}
							</ul>
						</dd>
						<dt><label for="poll-period">{$_('CreateEntry.poll-period')}</label></dt>
						<dd>
							<select id="poll-period" bind:value={pollPeriod}>
								<option value={1 * 60 * 60}>{$_('CreateEntry.poll-1-hour')}</option>
								<option value={6 * 60 * 60}>{$_('CreateEntry.poll-6-hours')}</option>
								<option value={12 * 60 * 60}>{$_('CreateEntry.poll-12-hours')}</option>
								<option value={1 * 24 * 60 * 60}>{$_('CreateEntry.poll-1-day')}</option>
							</select>
						</dd>
						<dt><label for="poll-type">{$_('CreateEntry.poll-type')}</label></dt>
						<dd>
							<select id="poll-type" bind:value={pollType}>
								<option value="singlechoice">{$_('CreateEntry.poll-single-choice')}</option>
								<option value="multiplechoice">{$_('CreateEntry.poll-multiple-choice')}</option>
							</select>
						</dd>
					</dl>
				</div>
			</div>
		{/if}
		<div class="CreateEntry__actions">
			<button class="Button" disabled={!canSendNote} onclick={callSendNote}>
				<span>{$_('CreateEntry.post')}</span>
			</button>
			{#if eventToReply !== undefined}
				<button
					class="Button Button--cancel"
					onclick={() => {
						showForm = false;
					}}
				>
					<span>{$_('CreateEntry.cancel')}</span>
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	img.channel-to-post {
		position: absolute;
		top: 8px;
		right: 32px;
		width: auto;
		height: 24px;
		object-fit: cover;
		border-radius: 10%;
	}
	span.channel-to-post {
		position: absolute;
		top: 0px;
		right: 32px;
	}
	textarea {
		appearance: none;
		background: transparent;
		border: none;
		border-radius: 0;
		font: inherit;
		outline: none;
		width: 100%;
		resize: none;
	}
	.select-upload-file {
		display: none;
	}
	.emoji-picker-container {
		position: absolute;
		top: 2em;
		left: -3em;
	}
	span.channel-clear {
		position: absolute;
		right: 10px;
		top: 3px;
	}
	span.channel-clear > button,
	button.ToolbarItem {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
	}
	span.channel-clear > button:disabled,
	button.ToolbarItem:disabled {
		cursor: not-allowed;
	}
	span.channel-clear > button.channel-clear,
	button.ToolbarItem {
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
	}
	span.channel-clear > button.channel-clear > svg {
		width: 16px;
		height: 16px;
		fill: gray;
	}
	.RichTextEditor__toolbar button.ToolbarItem.ql-cw {
		width: 15px;
		height: 16px;
	}
	button.ToolbarItem > svg {
		margin-bottom: -2px;
		width: 12px;
		height: 12px;
		fill: var(--secondary-text-color);
	}
	span.channel-clear > button.channel-clear:active > svg,
	button.ToolbarItem.on > svg {
		fill: yellow;
	}
	.CreateEntry__keyword + .CreateEntry__keyword .default-input-cw {
		border-radius: 0;
		border-top: 0;
	}
	.CreateEntry__keyword .default-input-cw {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}
	.empty-channel {
		z-index: 2;
		outline: none;
		border-color: red;
	}
	.toggle-mention {
		padding: 1px 3px;
	}
	.Button.toggle-mention.excluded:before {
		background-color: #cccccc;
		border: 2px solid #bfbfbf;
		box-shadow: 0 2px 0 #bebebe;
	}
</style>
