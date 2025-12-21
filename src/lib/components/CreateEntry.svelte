<script lang="ts">
	import { browser } from '$app/environment';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { defaultAccountUri, getRoboHashURL } from '$lib/config';
	import {
		getEmoji,
		getEmojiMap,
		getName,
		type ChannelContent,
		type ProfileContentEvent
	} from '$lib/utils';
	import type { RelayConnector } from '$lib/resource';
	import { onMount } from 'svelte';
	import type { EventTemplate, NostrEvent, UnsignedEvent } from 'nostr-tools/pure';
	import { BlossomClient, type BlobDescriptor } from 'nostr-tools/nipb7';
	import type { Signer } from 'nostr-tools/signer';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		readServerConfig,
		uploadFile,
		type DelayedProcessingResponse,
		type FileUploadResponse,
		type OptionalFormDataFields
	} from '$lib/nip96';
	import { getToken } from 'nostr-tools/nip98';
	import type { RxNostrSendOptions } from 'rx-nostr';
	import { unixNow } from 'applesauce-core/helpers';
	import * as mediabunny from 'mediabunny';
	import confetti from 'canvas-confetti';
	import { _ } from 'svelte-i18n';

	let {
		rc,
		loginPubkey,
		currentChannelId,
		currentBitchatGTag,
		eventToReply,
		isTopPage,
		channelMap,
		profileMap,
		isEnabledEventProtection,
		clientTag,
		uploaderSelected,
		uploaderType,
		eventsEmojiSet,
		eventFollowList,
		preInput,
		channelToPost = $bindable(),
		showForm = $bindable(),
		previewEvent = $bindable(),
		callInsertText = $bindable(),
		baseEventToEdit = $bindable()
	}: {
		rc: RelayConnector | undefined;
		loginPubkey: string | undefined;
		currentChannelId?: string | undefined;
		currentBitchatGTag?: string | undefined;
		eventToReply?: NostrEvent;
		isTopPage: boolean;
		channelMap: Map<string, ChannelContent>;
		profileMap: Map<string, ProfileContentEvent>;
		isEnabledEventProtection: boolean;
		clientTag: string[] | undefined;
		uploaderSelected: string;
		uploaderType: 'nip96' | 'blossom';
		eventsEmojiSet: NostrEvent[];
		eventFollowList: NostrEvent | undefined;
		preInput: string | null;
		channelToPost: ChannelContent | undefined;
		showForm: boolean;
		previewEvent: UnsignedEvent | undefined;
		callInsertText: (word: string, enableNewline?: boolean) => void;
		baseEventToEdit: NostrEvent | undefined;
	} = $props();

	let isCustomEmojiEnabled: boolean = $state(true);
	let pubkeysExcluded: string[] = $state([]);
	let hashtagsExcluded: string[] = $state([]);
	let filesToUpload: FileList | undefined = $state();
	let imetaMap: Map<
		string,
		{
			tags: [string, string][];
			content: string;
		}
	> = new Map<
		string,
		{
			tags: [string, string][];
			content: string;
		}
	>();
	let inputFile: HTMLInputElement;
	let textArea: HTMLTextAreaElement;
	let postButton: HTMLButtonElement;
	let logMessage: string | undefined = $state();

	let emojiPickerContainer: HTMLElement | undefined = $state();
	const callGetEmoji = () => {
		if (emojiPickerContainer === undefined) {
			return;
		}
		getEmoji(
			emojiPickerContainer,
			getEmojiMap(eventsEmojiSet),
			false,
			({ emojiStr }: { emojiStr: string }) => {
				insertText(emojiStr, false);
			}
		);
	};

	let isInProcess: boolean = $state(false);

	interface MyBlobDescriptor extends BlobDescriptor {
		nip94?: [string, string][];
	}

	const uploadFileExec = async () => {
		logMessage = undefined;
		let file: File | null = getFile();
		if (file === null) {
			return;
		}
		isInProcess = true;
		//圧縮
		if (/^(video|audio)/.test(file.type)) {
			file = await compress(file);
		}
		console.info('file uploading...');
		logMessage = 'file uploading...';
		try {
			if (uploaderType === 'nip96') {
				const [uploadedFileUrl, fileUploadResponse] = await uploadByNip96(uploaderSelected, file);
				if (fileUploadResponse.nip94_event !== undefined) {
					imetaMap.set(uploadedFileUrl, fileUploadResponse.nip94_event);
				}
				insertText(uploadedFileUrl);
			} else if (uploaderType === 'blossom') {
				const signer: Signer | undefined = window.nostr;
				if (signer === undefined) {
					throw Error('window.nostr is undefined');
				}
				const client = new BlossomClient(uploaderSelected, signer);
				const fileUploadResponse: MyBlobDescriptor = await client.uploadFile(file);
				const uploadedFileUrl: string = fileUploadResponse.url;
				if (!URL.canParse(uploadedFileUrl)) {
					throw Error('upload url is undefined');
				}
				if (fileUploadResponse.nip94 !== undefined) {
					imetaMap.set(uploadedFileUrl, { content: '', tags: fileUploadResponse.nip94 });
				}
				insertText(uploadedFileUrl);
			}
			console.info('file uploading complete');
			logMessage = undefined;
		} catch (error) {
			console.error(error);
			logMessage = (error as Error).message;
		}
		isInProcess = false;
	};

	const getFile = (): File | null => {
		if (filesToUpload === undefined || filesToUpload.length === 0) {
			return null;
		}
		let file: File | undefined;
		for (const f of filesToUpload) {
			file = f;
		}
		if (file === undefined) {
			return null;
		}
		return file;
	};

	// https://gihyo.jp/article/2025/10/misskey-20
	const compress = async (source: File): Promise<File> => {
		// 入力を準備
		const input = new mediabunny.Input({
			source: new mediabunny.BlobSource(source),
			formats: mediabunny.ALL_FORMATS
		});

		// 出力を準備。今回はmp4で出力
		const output = new mediabunny.Output({
			target: new mediabunny.BufferTarget(),
			format: new mediabunny.Mp4OutputFormat()
		});

		// 変換を行うインスタンス。今回はビットレートのクオリティをLOWにすることで、圧縮を行うように指定
		const conversion = await mediabunny.Conversion.init({
			input,
			output,
			video: {
				bitrate: mediabunny.QUALITY_LOW
			},
			audio: {
				bitrate: mediabunny.QUALITY_LOW
			}
		});

		// 処理の進捗が更新されたときのコールバック。進捗率は 0.0~1.0 で渡される
		conversion.onProgress = (p) => (logMessage = `${Math.round(p * 100)}%`);

		// 圧縮処理を実行 (注: 時間がかかる場合あり)
		console.info('file converting...');
		await conversion.execute();
		console.info('file converting complete');

		// 圧縮したデータを返す
		const file = new File([output.target.buffer!], source.name, { type: output.format.mimeType });

		const getSize = (file: File): number => Math.round((100 * file.size) / 1024 / 1024) / 100;
		console.info(`original file size: ${getSize(source)} MB`);
		console.info(`compressed file size: ${getSize(file)} MB`);

		return file;
	};

	const uploadByNip96 = async (
		uploaderUrl: string,
		file: File
	): Promise<[string, FileUploadResponse]> => {
		const nostr = window.nostr;
		if (nostr === undefined) {
			throw Error('window.nostr is undefined');
		}
		const sign = (e: EventTemplate) => nostr.signEvent(e);
		const config = await readServerConfig(uploaderUrl);
		const token = await getToken(config.api_url, 'POST', sign, true);
		const option: OptionalFormDataFields = {
			size: String(file.size),
			content_type: file.type
		};
		const fileUploadResponse: FileUploadResponse = await uploadFile(
			file,
			config.api_url,
			token,
			option
		);
		if (fileUploadResponse.status === 'error') {
			throw Error(fileUploadResponse.message);
		}
		console.info(fileUploadResponse.message);
		const processing_url = fileUploadResponse.processing_url;
		if (processing_url !== undefined && URL.canParse(processing_url)) {
			const sleep = (timeout: number) => new Promise((handler) => setTimeout(handler, timeout));
			let retry: number = 5;
			while (true) {
				const request = new Request(processing_url, {
					method: 'GET',
					headers: {
						Authorization: await getToken(processing_url, 'GET', sign, true)
					}
				});
				const response = await fetch(request);
				if (response.status === 201) {
					break;
				}
				const delayedProcessingResponse: DelayedProcessingResponse = await response.json();
				if (delayedProcessingResponse.status === 'error') {
					throw Error(delayedProcessingResponse.message);
				}
				console.info(delayedProcessingResponse.message);
				retry--;
				if (retry < 0) {
					throw Error('timeout');
				}
				await sleep(1000);
			}
		}
		const uploadedFileUrl = fileUploadResponse.nip94_event?.tags
			.find((tag) => tag[0] === 'url')
			?.at(1);
		if (uploadedFileUrl === undefined || !URL.canParse(uploadedFileUrl)) {
			throw Error('upload url is undefined');
		}
		return [uploadedFileUrl, fileUploadResponse];
	};

	const insertText = (word: string, enableNewline: boolean = true): void => {
		let sentence = textArea.value;
		const len = sentence.length;
		const pos = textArea.selectionStart;
		const before = sentence.slice(0, pos);
		const after = sentence.slice(pos, pos + len);
		if (enableNewline && !(before.length === 0 || before.endsWith('\n'))) {
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
	let contentToSend: string = $derived(preInput ?? '');
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

	const previewEventsPromise = $derived.by(async () => {
		const targetEventToReply =
			channelToPost?.eventkind40 ??
			eventToReply ??
			(currentChannelId !== undefined ? channelMap.get(currentChannelId)?.eventkind40 : undefined);
		const contentWarningReason = addContentWarning
			? reasonContentWarning.length > 0
				? reasonContentWarning
				: null
			: undefined;
		const nameForBitchat =
			currentBitchatGTag === undefined || loginPubkey === undefined
				? undefined
				: getName(loginPubkey, profileMap, eventFollowList, true, true);
		return rc?.makeEvent(
			loginPubkey ?? '',
			contentToSend,
			addPoll ? '' : channelNameToCreate,
			[], //除外をプレビューに反映させると選択できなくなってしまう
			[], //同上
			isEnabledEventProtection,
			clientTag,
			channelMap,
			eventsEmojiSet, //同上
			true,
			addPoll ? undefined : targetEventToReply,
			currentBitchatGTag,
			nameForBitchat,
			imetaMap,
			contentWarningReason,
			addPoll ? pollItems.filter((item) => item.length > 0) : undefined,
			addPoll ? unixNow() + pollPeriod : undefined,
			addPoll ? pollType : undefined,
			baseEventToEdit?.kind
		);
	});
	let previewEvents:
		| {
				eventToSend: UnsignedEvent;
				eventChannelToSend: UnsignedEvent | undefined;
				options: Partial<RxNostrSendOptions>;
		  }
		| undefined = $state();
	$effect(() => {
		previewEventsPromise.then((value) => {
			previewEvents = value;
		});
	});

	const canSendNote: boolean = $derived(
		!(
			contentToSend.length === 0 ||
			/nsec1[a-z\d]{58}/.test(contentToSend) ||
			(!addPoll &&
				channelNameToCreate.length === 0 &&
				isTopPage &&
				currentBitchatGTag === undefined) ||
			(addPoll && pollItems.filter((item) => item.length > 0).length < 2)
		)
	);
	//除外を設定していても反映されないプレビュー
	const previewEventLocal: UnsignedEvent | undefined = $derived(
		canSendNote ? previewEvents?.eventToSend : undefined
	);
	//除外が反映されるプレビュー
	const previewEventToShow: UnsignedEvent | undefined = $derived.by(() => {
		if (previewEventLocal === undefined) {
			return undefined;
		} else {
			const event: UnsignedEvent = {
				content: previewEventLocal.content,
				created_at: previewEventLocal.created_at,
				kind: previewEventLocal.kind,
				pubkey: previewEventLocal.pubkey,
				tags: []
			};
			for (const tag of previewEventLocal.tags) {
				//絵文字無効化の除外
				if (!isCustomEmojiEnabled && tag[0] === 'emoji') {
					continue;
				}
				//メンション無効化の除外
				if (tag[0] === 'p' && pubkeysExcluded.includes(tag[1])) {
					continue;
				}
				//ハッシュタグ無効化の除外
				if (tag[0] === 't' && hashtagsExcluded.includes(tag[1])) {
					continue;
				}
				event.tags.push([...tag]);
			}
			return event;
		}
	});
	//プレビュー表示には除外を反映させる
	$effect(() => {
		previewEvent = previewEventToShow;
	});

	const callConfetti = (): void => {
		let centerX: number;
		let centerY: number;
		const rect = postButton.getBoundingClientRect();
		centerX = rect.x + rect.width / 2;
		centerY = rect.y + rect.height / 2;
		confetti({
			origin: {
				x: centerX / window.innerWidth,
				y: centerY / window.innerHeight
			}
		});
	};

	const callSendNote = () => {
		if (loginPubkey === undefined || !canSendNote) {
			return;
		}
		const targetEventToReply = $state.snapshot(
			channelToPost?.eventkind40 ??
				eventToReply ??
				(currentChannelId !== undefined ? channelMap.get(currentChannelId)?.eventkind40 : undefined)
		);
		const contentWarningReason = addContentWarning
			? reasonContentWarning.length > 0
				? reasonContentWarning
				: null
			: undefined;
		const nameForBitchat =
			currentBitchatGTag === undefined || loginPubkey === undefined
				? undefined
				: getName(loginPubkey, profileMap, eventFollowList, true, true);
		rc?.sendNote(
			loginPubkey,
			contentToSend,
			addPoll ? '' : channelNameToCreate,
			$state.snapshot(pubkeysExcluded),
			$state.snapshot(hashtagsExcluded),
			isEnabledEventProtection,
			clientTag,
			channelMap,
			isCustomEmojiEnabled ? eventsEmojiSet : [],
			false,
			addPoll ? undefined : targetEventToReply,
			currentBitchatGTag,
			nameForBitchat,
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
			isCustomEmojiEnabled = true;
			if (isNeededShowEvent && event !== null) {
				const nevent: string = nip19.neventEncode({ ...event, author: event.pubkey });
				goto(resolve(`/entry/${nevent}`));
			}
		});
		//8/19はハイクの日
		const today = new Date();
		if (today.getMonth() + 1 === 8 && today.getDate() === 19) {
			callConfetti();
		}
	};

	const hasCustomEmoji: boolean = $derived(
		previewEventLocal?.tags.some((tag) => tag.length >= 2 && tag[0] === 'emoji') ?? false
	);
	const pubkeysMentioningTo: string[] = $derived(
		previewEventLocal?.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 'p')
			.map((tag) => tag[1]) ?? []
	);
	const hashtagsIncluded: string[] = $derived(
		previewEventLocal?.tags
			.filter((tag) => tag.length >= 2 && tag[0] === 't')
			.map((tag) => tag[1]) ?? []
	);

	onMount(() => {
		callInsertText = insertText;
	});
	beforeNavigate(() => {
		isCustomEmojiEnabled = true;
		pubkeysExcluded = [];
		hashtagsExcluded = [];
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
		{@const picture =
			loginPubkey === undefined
				? defaultAccountUri
				: URL.canParse(profileMap.get(loginPubkey)?.picture ?? '')
					? profileMap.get(loginPubkey)?.picture
					: getRoboHashURL(nip19.npubEncode(loginPubkey))}
		<a
			href={resolve(`/${loginPubkey === undefined ? '' : nip19.npubEncode(loginPubkey)}`)}
			class="CreateEntry__profile"><img src={picture} class="Avatar" alt="" /></a
		>
	{/if}
	<div class="CreateEntry__main">
		<div class="InputGroup">
			{#if currentChannelId === undefined && currentBitchatGTag === undefined && eventToReply === undefined && !addPoll}
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
							{#if currentChannelId === undefined && currentBitchatGTag === undefined && eventToReply === undefined}
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
							{#if hasCustomEmoji}
								<button
									class={isCustomEmojiEnabled
										? 'Button toggle-custom-emoji'
										: 'Button toggle-custom-emoji excluded'}
									onclick={() => {
										isCustomEmojiEnabled = !isCustomEmojiEnabled;
									}}
									title="enable custom emoji"
									aria-label="enable custom emoji"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="24"
										height="24"
										viewBox="0 0 24 24"
									>
										<path
											fill-rule="evenodd"
											d="M12,23 C5.92486775,23 1,18.0751322 1,12 C1,5.92486775 5.92486775,1 12,1 C18.0751322,1 23,5.92486775 23,12 C23,18.0751322 18.0751322,23 12,23 Z M12,21 C16.9705627,21 21,16.9705627 21,12 C21,7.02943725 16.9705627,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 Z M15.2746538,14.2978292 L16.9105622,15.4483958 C15.7945475,17.0351773 13.9775544,18 12,18 C10.0224456,18 8.20545254,17.0351773 7.08943782,15.4483958 L8.72534624,14.2978292 C9.4707028,15.3575983 10.6804996,16 12,16 C13.3195004,16 14.5292972,15.3575983 15.2746538,14.2978292 Z M14,11 L14,9 L16,9 L16,11 L14,11 Z M8,11 L8,9 L10,9 L10,11 L8,11 Z"
										/>
									</svg>
								</button>
							{/if}
							{#if pubkeysMentioningTo.length > 0 && previewEventLocal !== undefined && previewEventLocal.kind !== 4}
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
											src={prof !== undefined && URL.canParse(prof.picture ?? '')
												? prof.picture
												: getRoboHashURL(nip19.npubEncode(p))}
											alt={getName(p, profileMap, eventFollowList)}
											class="Avatar Avatar--sm"
										/></button
									>
								{/each}
							{/if}
							{#if hashtagsIncluded.length > 0}
								hashtags:
								{#each hashtagsIncluded as t (t)}
									{@const isExcluded = hashtagsExcluded.includes(t)}
									<button
										class={isExcluded ? 'Button toggle-hashtag excluded' : 'Button toggle-hashtag'}
										onclick={() => {
											if (isExcluded) {
												hashtagsExcluded = hashtagsExcluded.filter((hashtag) => hashtag !== t);
											} else {
												hashtagsExcluded.push(t);
											}
										}}>#{t}</button
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
			<button class="Button" disabled={!canSendNote} onclick={callSendNote} bind:this={postButton}>
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
			{#if logMessage !== undefined}
				<span>{logMessage}</span>
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
	span.ql-formats > button.toggle-custom-emoji,
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
	span.ql-formats > button.toggle-custom-emoji > svg {
		width: 24px;
		height: 16px;
		fill: var(--secondary-text-color);
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
	.Button.excluded:before {
		background-color: #cccccc;
		border: 2px solid #bfbfbf;
		box-shadow: 0 2px 0 #bebebe;
	}
</style>
