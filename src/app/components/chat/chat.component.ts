import {
  Component, OnInit, ViewChild, ElementRef,
  AfterViewChecked, PLATFORM_ID, Inject, NgZone,
  ChangeDetectorRef, OnDestroy, HostListener
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChatService, ServerProps } from '../../services/chat.service';
import { FileExtractService } from '../../services/file-extract.service';
import { Message, AttachedFile } from '../../models/chat.model';
import { marked, Renderer } from 'marked';
import { Subscription } from 'rxjs';
import {LandingPage} from '../landing-page/landing-page';
import {BsModalRef, BsModalService} from 'ngx-bootstrap/modal';
import {Registration} from '../registration/registration';
import {Router} from '@angular/router';
import {TooltipModule} from 'ngx-bootstrap/tooltip';

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface ConversationMeta { id: string; title: string; }

export interface RichMessage extends Message {
  renderedReasoningHtml?: SafeHtml;
  renderedFinalHtml?: SafeHtml;
  reasoningText?: string;
  finalText?: string;
  reasoningOpen?: boolean;   // reasoning is collapsed by default; toggled per message
}

export interface UserPrompt {
  id: string; text: string; files: AttachedFile[]; timestamp: Date;
}

interface ConversationState {
  messages: RichMessage[];
  chatHistory: { role: string; content: string }[];
  userPrompts: UserPrompt[];
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css'],
  providers: [ChatService],
})
export class ChatComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('messagesEnd')      private messagesEnd!:      ElementRef;
  @ViewChild('fileInput')        private fileInput!:        ElementRef;
  @ViewChild('textarea')         private textarea!:         ElementRef;
  @ViewChild('scrollContainer')  private scrollContainer!:  ElementRef;  // ← NEW
  @ViewChild('sbSearchInput')    private sbSearchInput?:    ElementRef<HTMLInputElement>;

  messages:      RichMessage[]                       = [];
  userInput:     string                              = '';
  isLoading:     boolean                             = false;
  serverOnline:  boolean                             = false;
  sidebarOpen:   boolean                             = true;
  isDragging:    boolean                             = false;
  selectedFiles: File[]                              = [];
  filePreviews:  AttachedFile[]                      = [];
  chatHistory:   { role: string; content: string }[] = [];
  conversations: ConversationMeta[]                  = [];
  currentConvId: string                              = '';
  convSearch:    string                              = '';
  searchOpen:    boolean                             = false;
  chatsOverviewOpen: boolean                         = false;
  theme:         'light' | 'dark' | 'system'         = 'system';
  resolvedTheme: 'light' | 'dark'                    = 'dark';
  plusMenuOpen:  boolean                             = false;
  incognito:     boolean                             = false;
  copiedId:      string                              = '';
  userPrompts:   UserPrompt[]                        = [];
  serverProps:   ServerProps | null                  = null;
  modelAlias:    string                              = 'Loading…';
  contextSize:   number                              = 0;
  userData:      any                                 = [];
  registrationData: any                             = [];
  accountMenuOpen: boolean                           = false;

  // ── Scroll-lock state ────────────────────────────────────────────────────
  userScrolled:  boolean = false;   // true when user has scrolled up during streaming

  // Per-attachment extraction state (aligned by index with selectedFiles/filePreviews).
  private fileExtracts: { status: 'pending' | 'done' | 'failed' | 'unsupported'; text: string; note?: string; promise: Promise<void> }[] = [];

  private convStore          = new Map<string, ConversationState>();
  private isBrowser          = false;
  private shouldScroll       = false;
  private codeBlockListeners = new Map<Element, boolean>();
  private streamSub:             Subscription | null = null;
  private activeAssistantMsgId:  string | null       = null;
  private stopRequested          = false;
  private mql:                   MediaQueryList | null = null;

  constructor(
    private chatService: ChatService,
    private fileExtract: FileExtractService,
    private sanitizer:   DomSanitizer,
    private zone:        NgZone,
    private cdr:         ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object,
    private modalService: BsModalService,
    public bsModalRef: BsModalRef,
    private router: Router,
    public registrationbsModalRef: BsModalRef
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (this.isBrowser) this.setupMarked();
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      let user: any;
      user = localStorage.getItem('user');
      this.userData = JSON.parse(user);
      if (!this.userData?.name) {
        this.openModal();
        this.newConversation();
      } else {
        this.loadUserConversations();
      }
    } else {
      // SSR / prerender: do NOT open the modal here — ngx-bootstrap's show()
      // reaches for document.activeElement, which is undefined on the server and
      // throws during prerender. The modal is a browser-only interaction; it opens
      // correctly when ngOnInit re-runs on the client (the isPlatformBrowser branch).
      this.newConversation();
    }

    if (this.isBrowser) {
      this.initTheme();
      const cached = this.chatService.getProps();
      if (cached) this.applyProps(cached);
      setTimeout(() => {
        this.chatService.fetchAndCacheProps().subscribe({
          next:  p  => { this.applyProps(p); this.serverOnline = true; },
          error: () => { this.checkServer(); },
        });
      }, 0);
    }
  }

  ngOnDestroy(): void {
    this.streamSub?.unsubscribe();
    try { this.mql?.removeEventListener?.('change', this.onSystemThemeChange); } catch {}
  }

  // ── Theme (light / dark / system) ─────────────────────────────────────────
  get isLight(): boolean { return this.resolvedTheme === 'light'; }

  private initTheme(): void {
    let saved: string | null = null;
    try { saved = localStorage.getItem('isage_theme'); } catch {}
    this.theme = (saved === 'light' || saved === 'dark' || saved === 'system') ? saved : 'system';
    try {
      if (window.matchMedia) {
        this.mql = window.matchMedia('(prefers-color-scheme: dark)');
        this.mql.addEventListener?.('change', this.onSystemThemeChange);
      }
    } catch {}
    this.applyTheme();
  }

  private onSystemThemeChange = (): void => {
    if (this.theme === 'system') { this.applyTheme(); this.cdr.markForCheck(); }
  };

  setTheme(mode: 'light' | 'dark' | 'system'): void {
    this.theme = mode;
    try { localStorage.setItem('isage_theme', mode); } catch {}
    this.applyTheme();
  }

  private applyTheme(): void {
    const systemDark = this.mql ? this.mql.matches : true;
    this.resolvedTheme = this.theme === 'system' ? (systemDark ? 'dark' : 'light') : this.theme;
  }

  private applyProps(props: ServerProps): void {
    this.serverProps = props;
    this.modelAlias  = props.model_alias ?? 'Unknown model';
    this.contextSize = props.default_generation_settings?.n_ctx ?? 0;
  }

  ngAfterViewChecked(): void {
    if (!this.isBrowser) return;

    // ── Scroll-lock: only auto-scroll if user hasn't scrolled up ────────────
    if (this.shouldScroll) {
      if (!this.userScrolled) {
        try {
          this.messagesEnd?.nativeElement.scrollIntoView({ behavior: 'smooth' });
        } catch { }
      }
      // Always clear the flag so we don't loop
      this.shouldScroll = false;
    }

    // Wire up code-copy buttons
    document.querySelectorAll('.code-block').forEach(block => {
      if (this.codeBlockListeners.has(block)) return;
      this.codeBlockListeners.set(block, true);
      const btn = block.querySelector('.code-copy-btn') as HTMLButtonElement | null;
      const raw = (block as HTMLElement).getAttribute('data-raw-code');
      if (!btn || !raw) return;
      btn.addEventListener('click', () => {
        const decoded = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        this.copyTextToClipboard(decoded).then(ok => {
          if (!ok) return;
          const label = btn.querySelector('.ccp-label');
          const prevText = label?.textContent ?? 'Copy';
          btn.classList.add('copied');
          if (label) label.textContent = 'Copied!';
          setTimeout(() => {
            btn.classList.remove('copied');
            if (label) label.textContent = prevText;
          }, 2000);
        });
      });
    });
  }

  // ── Scroll listener: called from (scroll) on the .msgs container ─────────
  onMsgsScroll(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If user is more than 80px from the bottom, consider them as "scrolled up"
    this.userScrolled = distFromBottom > 80;
  }

  // ── Programmatic scroll-to-bottom (used by the "↓ scroll down" button) ───
  scrollToBottom(): void {
    this.userScrolled = false;
    try {
      this.messagesEnd?.nativeElement.scrollIntoView({ behavior: 'smooth' });
    } catch { }
  }

  // ── Reasoning collapse toggle (hidden by default, click to reveal) ────────
  toggleReasoning(msg: RichMessage): void {
    msg.reasoningOpen = !msg.reasoningOpen;
  }

  // ── Markdown ──────────────────────────────────────────────────────────────
  private setupMarked(): void {
    const renderer = new Renderer();
    (renderer as any).code = (code: string, infostring?: string) => {
      const lang = (infostring ?? '').trim().split(/\s+/)[0] || 'plaintext';
      const nl = lang.toLowerCase();
      const isTerm = new Set(['bash','sh','zsh','shell','console','terminal','powershell','ps1','cmd','bat']).has(nl);
      const dl = nl === 'plaintext' ? 'bash' : lang;
      const esc = escapeHtml(code);
      const bg = isTerm ? 'linear-gradient(180deg,#0f131b 0%,#0b0f15 100%)' : '#0b1018';
      return `<div class="${isTerm ? 'code-block terminal-block' : 'code-block'}" data-language="${dl}" data-raw-code="${esc}"
  style="background:${bg};border:1px solid rgba(255,255,255,.12);border-radius:14px;margin:16px 0;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 6px 26px rgba(0,0,0,.45);">
  <div class="code-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.08);min-height:38px;">
    <span class="code-lang" style="font-size:12px;font-weight:500;color:#9aa3b2;text-transform:none;letter-spacing:0;">${dl}</span>
    <button class="code-copy-btn" type="button" title="Copy code" style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;background:transparent;border:1px solid rgba(255,255,255,.14);color:#c3c3c3;border-radius:7px;cursor:pointer;font-family:var(--font);font-size:12px;font-weight:500;">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2" ry="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>
      <span class="ccp-label">Copy</span>
    </button>
  </div>
  <pre class="language-${dl}" style="margin:0;padding:16px 18px 18px;overflow-x:auto;background:transparent;line-height:1.65;"><code class="language-${dl}" style="background:none;border:none;padding:0;color:${isTerm ? '#f6c177' : '#f0f3f8'};font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;white-space:pre;">${esc}</code></pre>
</div>`;
    };
    (renderer as any).table = (h: string, b: string) =>
      `<div class="table-wrapper"><table class="fl-table"><thead>${h}</thead><tbody>${b}</tbody></table></div>`;
    (renderer as any).tablerow  = (c: string) => `<tr>${c}</tr>`;
    (renderer as any).tablecell = (c: string, f: any) => {
      const t = f.header ? 'th' : 'td';
      return `<${t}${f.align ? ` style="text-align:${f.align}"` : ''}>${c}</${t}>`;
    };
    marked.use({ renderer, breaks: true, gfm: true, pedantic: false });
  }

  private renderMarkdown(text: string): SafeHtml {
    let html = marked.parse(text) as string;
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-block">$1</div>');
    html = html.replace(/\$(.*?)\$/g, '<span class="math-inline">$1</span>');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private renderPlain(text: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(escapeHtml(text).replace(/\n/g, '<br>'));
  }

  private isTable(text: string): boolean {
    return /^\s*\|.+\|\s*$/m.test(text) && /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/m.test(text);
  }

  private extractSections(raw: string): { reasoning: string; finalAnswer: string } {
    let text = raw
      .replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '')
      .replace(/\n{3,}/g, '\n\n').trim();
    const parts: string[] = [];
    text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, t: string) => {
      const s = t.trim(); if (s) parts.push(s); return '';
    }).trim();
    if (parts.length) return { reasoning: parts.join('\n\n'), finalAnswer: text || 'No final answer.' };
    const m = text.match(/(?:^|\n)\s*#{0,3}\s*reasoning\s*:?\s*\n([\s\S]*?)\n\s*#{0,3}\s*final(?:\s+answer)?\s*:?\s*\n([\s\S]*)$/i);
    if (m) return { reasoning: m[1].trim(), finalAnswer: m[2].trim() || 'No final answer.' };
    return { reasoning: '', finalAnswer: text || 'No response. Please try again.' };
  }

 private cleanResponse(raw: string): string {
    const cleaned = raw.replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '')
      .replace(/\n{3,}/g, '\n\n').trim() || 'No response. Please try again.';
    return cleaned.replace(/mini\s*-?\s*max(?:[\s-]*m?\s*2\.?5)?/gi, 'iSAGE');
  }

  private updateMessageHtml(msg: RichMessage): void {
    if (!msg.content) { msg.renderedReasoningHtml = undefined; msg.renderedFinalHtml = undefined; return; }
    try {
      const s = this.extractSections(msg.content);
      msg.reasoningText = s.reasoning; msg.finalText = s.finalAnswer;
      msg.renderedReasoningHtml = s.reasoning   ? this.renderMarkdown(s.reasoning)   : undefined;
      msg.renderedFinalHtml     = s.finalAnswer ? this.renderMarkdown(s.finalAnswer) : undefined;
    } catch {
      msg.renderedFinalHtml = this.sanitizer.bypassSecurityTrustHtml(msg.content.replace(/\n/g, '<br>'));
    }
  }

  private makeChunkHandler(msgId: string): (text: string) => void {
    return (fullText: string) => {
      this.zone.run(() => {
        const msg = this.messages.find(m => m.id === msgId);
        if (!msg || msg.content === fullText) return;

        msg.content = fullText;
        const s = this.extractSections(fullText);
        msg.reasoningText = s.reasoning;
        msg.finalText = s.finalAnswer;

        msg.renderedReasoningHtml = s.reasoning
          ? (this.isTable(s.reasoning) ? this.renderMarkdown(s.reasoning) : this.renderPlain(s.reasoning))
          : undefined;
        msg.renderedFinalHtml = this.isTable(s.finalAnswer)
          ? this.renderMarkdown(s.finalAnswer)
          : this.renderPlain(s.finalAnswer);

        this.shouldScroll = true;
        this.messages = [...this.messages];
        this.cdr.markForCheck();
        this.cdr.detectChanges();
      });
    };
  }

  // ── Conversation management ───────────────────────────────────────────────
  private saveCurrentConv(): void {
    if (!this.currentConvId) return;

    this.convStore.set(this.currentConvId, {
      messages:    [...this.messages],
      chatHistory: [...this.chatHistory],
      userPrompts: [...this.userPrompts],
    });

    const convObject = Object.fromEntries(this.convStore);

    const cleanConvObject: any = {};
    Object.entries(convObject).forEach(([id, state]) => {
      cleanConvObject[id] = {
        chatHistory: state.chatHistory,
        userPrompts: state.userPrompts,
        messages: state.messages.map(({
                                        renderedFinalHtml,
                                        renderedReasoningHtml,
                                        ...rest
                                      }) => rest),
      };
    });

    if (this.userData.type !== 'guest' && !this.incognito) {
      this.chatService.saveConv(cleanConvObject).subscribe({
        next:  (res) => console.log('Conversation saved:', res),
        error: (err) => console.error('Failed to save conversation:', err)
      });
    }
  }

  private loadConv(id: string): void {
    const s = this.convStore.get(id);
    if (s) {
      this.messages    = [...s.messages];
      this.chatHistory = [...s.chatHistory];
      this.userPrompts = [...s.userPrompts];
    } else {
      this.messages = []; this.chatHistory = []; this.userPrompts = [];
    }
  }

  newConversation(): void {
    this.saveCurrentConv();
    const id = Date.now().toString();
    this.conversations.unshift({ id, title: 'New conversation' });
    this.currentConvId = id;
    this.convStore.set(id, { messages: [], chatHistory: [], userPrompts: [] });
    this.messages = []; this.chatHistory = []; this.userPrompts = [];
    this.clearFiles(); this.userInput = '';
    this.userScrolled = false;  // ← reset scroll-lock on new conversation
  }

  /** Incognito / temporary chat: conversations are NOT persisted to the backend
   *  while it's on. Toggling starts a fresh chat so the boundary is clean. */
  toggleIncognito(): void {
    this.incognito = !this.incognito;
    this.newConversation();
  }

  selectConversation(id: string): void {
    if (id === this.currentConvId) return;
    this.saveCurrentConv();
    this.currentConvId = id;
    this.loadConv(id);
    this.clearFiles();
    this.userInput    = '';
    this.userScrolled = false;  // ← reset scroll-lock when switching conversations
    this.shouldScroll = true;
  }

  checkServer(): void {
    this.chatService.checkHealth().subscribe({
      next:  () => { this.serverOnline = true; },
      error: () => { this.serverOnline = false; },
    });
  }

  refreshProps(): void {
    this.chatService.fetchAndCacheProps().subscribe({
      next:  p  => { this.applyProps(p); this.serverOnline = true; },
      error: () => { this.serverOnline = false; },
    });
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
    input.value = '';
  }

  addFiles(files: File[]): void {
    files.forEach(file => {
      this.selectedFiles.push(file);
      const preview: AttachedFile = { name: file.name, type: file.type, size: file.size };
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e: ProgressEvent<FileReader>) => { preview.url = e.target?.result as string; };
        reader.readAsDataURL(file);
      }
      this.filePreviews.push(preview);

      // Start extracting text immediately (in the background) so it's ready by
      // the time the user hits send. The chip shows a spinner while pending.
      const rec: { status: 'pending' | 'done' | 'failed' | 'unsupported'; text: string; note?: string; promise: Promise<void> } =
        { status: 'pending', text: '', promise: Promise.resolve() };
      rec.promise = this.fileExtract.extract(file).then(res => {
        rec.status = res.ok ? 'done' : 'unsupported';
        rec.text = res.text;
        rec.note = res.note;
        this.cdr.markForCheck();
      }).catch(() => { rec.status = 'failed'; });
      this.fileExtracts.push(rec);
    });
  }

  removeFile(i: number): void { this.selectedFiles.splice(i, 1); this.filePreviews.splice(i, 1); this.fileExtracts.splice(i, 1); }
  clearFiles(): void { this.selectedFiles = []; this.filePreviews = []; this.fileExtracts = []; }

  /** Extraction status for the file chip at index i (drives the spinner). */
  fileStatus(i: number): 'pending' | 'done' | 'failed' | 'unsupported' {
    return this.fileExtracts[i]?.status ?? 'pending';
  }

  // ── "+" attachment menu ─────────────────────────────────────────────────────
  togglePlusMenu(e: Event): void { e.stopPropagation(); this.plusMenuOpen = !this.plusMenuOpen; }
  pickFiles(): void { this.plusMenuOpen = false; this.fileInput?.nativeElement.click(); }

  @HostListener('document:click')
  onDocumentClick(): void { if (this.plusMenuOpen) this.plusMenuOpen = false; }

  /** Builds the text context appended to the prompt for attached files, waiting
   *  for any still-running extractions. All parsing happens client-side (see
   *  FileExtractService) so the file contents never leave the device. */
  private async buildFileContext(): Promise<string> {
    if (!this.selectedFiles.length) return '';
    await Promise.all(this.fileExtracts.map(r => r.promise));
    const parts: string[] = [];
    this.selectedFiles.forEach((file, i) => {
      const rec = this.fileExtracts[i];
      if (rec && rec.status === 'done' && rec.text.trim()) {
        parts.push(`\n\n----- Attached file: ${file.name} -----\n${rec.text}\n----- end of ${file.name} -----`);
      } else {
        const why = rec?.note ? ` (${rec.note})` : '';
        parts.push(`\n\n[The user attached "${file.name}"${why}, but no readable text could be extracted. Ask them to describe what they need.]`);
      }
    });
    return parts.join('');
  }
  onDragOver(e: DragEvent): void { e.preventDefault(); this.isDragging = true; }
  onDragLeave(): void { this.isDragging = false; }
  onDrop(e: DragEvent): void {
    e.preventDefault(); this.isDragging = false;
    if (e.dataTransfer?.files?.length) this.addFiles(Array.from(e.dataTransfer.files));
  }

  /** Paste files/screenshots straight into the composer (Ctrl+V), like Claude. */
  onPaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) { e.preventDefault(); this.addFiles(files); }
  }
  onKeyDown(e: KeyboardEvent): void { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }
  autoResize(e: Event): void {
    const t = e.target as HTMLTextAreaElement;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 180) + 'px';
  }
  get canSend(): boolean { return (!!this.userInput.trim() || this.selectedFiles.length > 0) && !this.isLoading; }

  get currentConvTitle(): string {
    const current = this.conversations.find(c => c.id === this.currentConvId);
    const title = current?.title?.trim();
    if (title && title !== 'New conversation') return title;
    return 'iSAGE 2.0';
  }

  /** Conversations filtered by the sidebar search box (title contains query). */
  get filteredConversations(): ConversationMeta[] {
    const q = this.convSearch.trim().toLowerCase();
    if (!q) return this.conversations;
    return this.conversations.filter(c => (c.title || '').toLowerCase().includes(q));
  }

  /** Header search icon (Claude-style): reveals the chat-search input and focuses
   *  it; toggling closed clears the query so the recents list shows everything. */
  toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (this.searchOpen) {
      setTimeout(() => this.sbSearchInput?.nativeElement?.focus(), 0);
    } else {
      this.convSearch = '';
    }
  }

  /** Dismiss the search input (Esc) and reset the filter. */
  closeSearch(): void {
    if (this.searchOpen) {
      this.searchOpen = false;
      this.convSearch = '';
    }
  }

  // ── "Chats" destination — a full overview of every conversation ─────────────
  /** The "Chats" nav item opens an overview of all conversations (Claude-style),
   *  instead of doing nothing. */
  openChatsOverview(): void {
    this.searchOpen = false;
    this.convSearch = '';
    this.chatsOverviewOpen = true;
    if (this.isBrowser && window.innerWidth <= 900) this.sidebarOpen = false;
  }

  /** Close the overview and return to the current chat. */
  closeChatsOverview(): void {
    this.chatsOverviewOpen = false;
  }

  /** Open a conversation from the overview and drop back into the chat view. */
  openChatFromOverview(id: string): void {
    this.chatsOverviewOpen = false;
    this.convSearch = '';
    this.selectConversation(id);
  }

  /** Start a fresh conversation from the overview. */
  newChatFromOverview(): void {
    this.chatsOverviewOpen = false;
    this.convSearch = '';
    this.newConversation();
  }

  /** Two-letter initials for the Claude-style sidebar avatar (first two words). */
  get userInitials(): string {
    const name = (this.userData?.name || '').trim();
    if (!name) return 'U';
    const parts = name.split(/\s+/).filter(Boolean);
    const initials = parts.slice(0, 2).map((p: string) => p.charAt(0)).join('');
    return (initials || parts[0]).toUpperCase() || 'U';
  }

  getFileIcon(type: string): string {
    if (type.startsWith('image/')) return '🖼️'; if (type.startsWith('audio/')) return '🎵';
    if (type.startsWith('video/')) return '🎬'; if (type.includes('pdf')) return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel')) return '📊';
    if (type.includes('text')) return '📃'; return '📎';
  }
  formatSize(b: number): string {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  formatTime(d: Date): string { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  private removeHistoryReplyForPrompt(promptText: string): void {
    const reversed = [...this.chatHistory].reverse();
    const lastUserIndex = reversed.findIndex(entry => entry.role === 'user' && entry.content === promptText);
    if (lastUserIndex < 0) return;

    const userIndex = this.chatHistory.length - 1 - lastUserIndex;
    for (let i = userIndex + 1; i < this.chatHistory.length; i++) {
      if (this.chatHistory[i].role === 'assistant') {
        this.chatHistory.splice(i, 1);
        break;
      }
    }
  }

  copyMessage(id: string, content: string): void {
    this.copyTextToClipboard(content).then(ok => {
      if (!ok) return;
      this.copiedId = id;
      setTimeout(() => { this.copiedId = ''; this.cdr.markForCheck(); }, 2000);
      this.cdr.markForCheck();
    });
  }

  /** Copy that also works on plain-HTTP LAN origins (e.g. 192.168.x.x:4200),
   *  where navigator.clipboard is unavailable — falls back to execCommand. */
  copyTextToClipboard(text: string): Promise<boolean> {
    if (typeof window !== 'undefined' && window.isSecureContext && navigator?.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => this.legacyCopy(text));
    }
    return Promise.resolve(this.legacyCopy(text));
  }

  private legacyCopy(text: string): boolean {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  getUserPrompt(msgId: string): UserPrompt | undefined { return this.userPrompts.find(p => p.id === msgId); }
  isLastUserPrompt(promptId: string): boolean {
    if (!this.userPrompts.length || this.isLoading) return false;
    return this.userPrompts[this.userPrompts.length - 1].id === promptId;
  }

  regenerateResponse(msgId: string): void {
    if (this.isLoading) return;

    const prompt = this.userPrompts.find(p => p.id === msgId);
    if (!prompt) return;

    const userIndex = this.messages.findIndex(m => m.id === msgId && m.role === 'user');
    if (userIndex < 0) return;

    let assistantIndex = -1;
    for (let i = userIndex + 1; i < this.messages.length; i++) {
      if (this.messages[i].role === 'assistant') {
        assistantIndex = i;
        break;
      }
    }

    if (assistantIndex >= 0) {
      this.messages.splice(assistantIndex, 1);
    }

    this.removeHistoryReplyForPrompt(prompt.text);

    const blockedCategory = this.chatService.checkForBlockedContent(prompt.text);
    if (blockedCategory) {
      this.insertLocalAssistant(
        "I'm iSAGE, and I'm not able to help with that request. If you're going through something difficult, please reach out to someone you trust or a professional who can help.",
        assistantIndex
      );
      this.shouldScroll = true;
      this.saveCurrentConv();
      return;
    }

    // ── iSAGE identity protection on regenerate ──────────────────────────────
    if (this.chatService.checkForIdentityProbe(prompt.text)) {
      this.insertLocalAssistant(this.chatService.ISAGE_IDENTITY_RESPONSE, assistantIndex);
      this.shouldScroll = true;
      this.saveCurrentConv();
      return;
    }

    this.userScrolled = false;
    this.isLoading = true;

    const aiMsgId = (Date.now() + 1).toString();
    const insertIndex = assistantIndex >= 0 ? assistantIndex : this.messages.length;
    this.messages.splice(insertIndex, 0, { id: aiMsgId, role: 'assistant', content: '', timestamp: new Date() });
    this.activeAssistantMsgId = aiMsgId;
    this.stopRequested = false;
    this.shouldScroll = true;
    this.cdr.detectChanges();

    const payload = this.chatHistory.slice(-4);
    const convId = this.currentConvId;
    this.streamSub?.unsubscribe();

    const onChunk = this.makeChunkHandler(aiMsgId);

    this.streamSub = this.chatService.sendMessageStream(payload, onChunk, this.userData.type).subscribe({
      next: (finalText: string) => {
        const stored = this.convStore.get(convId);
        if (stored) {
          const m = stored.messages.find(message => message.id === aiMsgId);
          if (m) m.content = finalText;
        }
      },
      error: (err: any) => {
        this.streamSub = null;
        this.activeAssistantMsgId = null;
        if (this.stopRequested) { this.stopRequested = false; return; }

        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = this.streamErrorMessage(err);
          this.updateMessageHtml(msg);
        }
        this.shouldScroll = true;
        this.saveCurrentConv();

        this.zone.run(() => {
          this.isLoading = false;
          this.serverOnline = false;
          this.messages = [...this.messages];
          this.cdr.markForCheck();
          this.cdr.detectChanges();
        });
      },
      complete: () => {
        this.streamSub = null;
        this.activeAssistantMsgId = null;
        this.serverOnline = true;

        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = this.cleanResponse(msg.content);
          const { finalAnswer } = this.extractSections(msg.content);
          this.chatHistory.push({ role: 'assistant', content: finalAnswer });
          this.updateMessageHtml(msg);
        }
        this.shouldScroll = true;
        this.saveCurrentConv();

        this.zone.run(() => {
          this.isLoading = false;
          this.messages = [...this.messages];
          this.cdr.markForCheck();
          this.cdr.detectChanges();
        });
      },
    });
  }

  editUserPrompt(prompt: UserPrompt): void {
    if (!this.isLastUserPrompt(prompt.id)) return;
    this.userInput = prompt.text; this.clearFiles();
    if (this.textarea?.nativeElement) {
      const el = this.textarea.nativeElement as HTMLTextAreaElement;
      el.focus(); el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  }

  // ── Local (non-model) exchanges for guardrail + identity protection ─────────
  /** Records a user turn + a canned assistant reply locally, WITHOUT calling the
   *  model and WITHOUT adding it to chatHistory — so guardrail / identity-probe
   *  turns never become model context on later turns. */
  private pushLocalExchange(userText: string, assistantText: string): void {
    const uid = Date.now().toString();
    this.userPrompts.push({ id: uid, text: userText, files: [...this.filePreviews], timestamp: new Date() });
    this.messages.push({ id: uid, role: 'user', content: userText, files: [...this.filePreviews], timestamp: new Date() });

    const conv = this.conversations.find(c => c.id === this.currentConvId);
    if (conv && conv.title === 'New conversation') conv.title = userText.slice(0, 40);

    const aiMsg: RichMessage = {
      id: (Date.now() + 1).toString(), role: 'assistant', content: assistantText, timestamp: new Date(),
    };
    this.updateMessageHtml(aiMsg);
    this.messages.push(aiMsg);
    this.messages = [...this.messages];
    this.saveCurrentConv();
  }

  /** Human-friendly text for a streaming error, including the backend proxy's
   *  429 rate-limit and the client-side guest cap. */
  private streamErrorMessage(err: any): string {
    const m: string = err?.message ?? '';
    if (m === 'RATE_LIMIT' || m.includes('429') || /guest limit/i.test(m)) {
      return this.userData?.type === 'guest'
        ? "You've reached the guest limit. Please log in to continue using iSAGE."
        : "You've reached your usage limit for now. Please try again a little later.";
    }
    // Backend proxy is up but its upstream LLM engine (llama-server) is
    // unreachable: it either answers /v1/chat/completions with an
    // {"error":"upstream ..."} SSE event, or returns a 502/503.
    if (/^UPSTREAM/i.test(m) || /upstream/i.test(m) || m.includes('HTTP 502') || m.includes('HTTP 503')) {
      return 'The iSAGE engine is offline or still starting up. Please try again in a moment.';
    }
    if (m.includes('TimeoutError') || err?.name === 'TimeoutError') {
      return 'Timed out. Try a shorter message.';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return "Can't reach the iSAGE server. Check that the backend is running and reachable.";
    }
    return `Connection error: ${m || 'Check the iSAGE server'}`;
  }

  /** Inserts a canned assistant reply (rendered) at the given index, or at the
   *  end when index < 0. Used when regenerating a guardrail / identity turn. */
  private insertLocalAssistant(text: string, index: number): void {
    const aiMsg: RichMessage = {
      id: (Date.now() + 2).toString(), role: 'assistant', content: text, timestamp: new Date(),
    };
    this.updateMessageHtml(aiMsg);
    const at = index >= 0 ? index : this.messages.length;
    this.messages.splice(at, 0, aiMsg);
    this.messages = [...this.messages];
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  //new added
  async send(): Promise<void> {
    if (!this.canSend) return;

    // ── Safety guardrail: block unsafe requests before they reach the model ──
    const blockedCategory = this.chatService.checkForBlockedContent(this.userInput);
    if (blockedCategory) {
      this.pushLocalExchange(
        this.userInput,
        "I'm iSAGE, and I'm not able to help with that request. If you're going through something difficult, please reach out to someone you trust or a professional who can help."
      );
      this.userInput = ''; this.clearFiles();
      if (this.textarea) this.textarea.nativeElement.style.height = 'auto';
      this.userScrolled = false;
      this.shouldScroll = true;
      return;
    }

    // ── iSAGE identity protection: a probe/jailbreak never reaches the model ──
    if (this.chatService.checkForIdentityProbe(this.userInput)) {
      this.pushLocalExchange(this.userInput, this.chatService.ISAGE_IDENTITY_RESPONSE);
      this.userInput = ''; this.clearFiles();
      if (this.textarea) this.textarea.nativeElement.style.height = 'auto';
      this.userScrolled = false;
      this.shouldScroll = true;
      return;
    }

    // ── Reset scroll-lock when user sends a new message ─────────────────────
    this.userScrolled = false;

    // Capture the typed text + attached files, then read the files into text so
    // the model actually receives their contents (not just a chip in the UI).
    const typedText   = this.userInput;
    const filesForTurn = [...this.selectedFiles];
    const fileContext = await this.buildFileContext();
    const modelInput  = (typedText + fileContext).trim();

    const msgId = Date.now().toString();
    this.userPrompts.push({ id: msgId, text: typedText, files: [...this.filePreviews], timestamp: new Date() });
    this.messages.push({ id: msgId, role: 'user', content: typedText, files: [...this.filePreviews], timestamp: new Date() });
    this.shouldScroll = true;

    const conv = this.conversations.find(c => c.id === this.currentConvId);
    if (conv && conv.title === 'New conversation') {
      conv.title = (typedText.slice(0, 40) || filesForTurn[0]?.name || 'New conversation');
    }

    // Payload carries the file contents; chatHistory keeps only the typed text so
    // later turns stay lean (attachments are context for the turn they're sent on).
    const payload = [...this.chatHistory.slice(-4), { role: 'user', content: modelInput }];
    this.chatHistory.push({ role: 'user', content: typedText });

    this.userInput = ''; this.clearFiles();
    if (this.textarea) this.textarea.nativeElement.style.height = 'auto';
    this.isLoading = true;

    const aiMsgId = (Date.now() + 1).toString();
    this.messages.push({ id: aiMsgId, role: 'assistant', content: '', timestamp: new Date() });
    this.activeAssistantMsgId = aiMsgId;
    this.stopRequested = false;
    this.shouldScroll  = true;
    this.cdr.detectChanges();

    const convId = this.currentConvId;
    this.streamSub?.unsubscribe();

    const onChunk = this.makeChunkHandler(aiMsgId);

    this.streamSub = this.chatService.sendMessageStream(payload, onChunk, this.userData.type).subscribe({
      next: (finalText: string) => {
        const stored = this.convStore.get(convId);
        if (stored) {
          const m = stored.messages.find(m => m.id === aiMsgId);
          if (m) m.content = finalText;
        }
      },
      error: (err: any) => {
        this.streamSub = null;
        this.activeAssistantMsgId = null;
        if (this.stopRequested) { this.stopRequested = false; return; }

        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = this.streamErrorMessage(err);
          this.updateMessageHtml(msg);
        }
        this.shouldScroll = true;
        this.saveCurrentConv();

        this.zone.run(() => {
          this.isLoading = false;
          this.serverOnline = false;
          this.messages = [...this.messages];
          this.cdr.markForCheck();
          this.cdr.detectChanges();
        });
      },
      complete: () => {
        this.streamSub = null;
        this.activeAssistantMsgId = null;
        this.serverOnline = true;

        const msg = this.messages.find(m => m.id === aiMsgId);
        if (msg) {
          msg.content = this.cleanResponse(msg.content);
          const { finalAnswer } = this.extractSections(msg.content);
          this.chatHistory.push({ role: 'assistant', content: finalAnswer });
          this.updateMessageHtml(msg);
        }
        this.shouldScroll = true;
        this.saveCurrentConv();

        this.zone.run(() => {
          this.isLoading = false;
          this.messages = [...this.messages];
          this.cdr.markForCheck();
          this.cdr.detectChanges();
        });
      },
    });
  }

  // ── Pause ─────────────────────────────────────────────────────────────────
  pauseGeneration(): void {
    if (!this.isLoading) return;
    this.stopRequested = true;
    this.streamSub?.unsubscribe();
    this.streamSub = null;

    if (this.activeAssistantMsgId) {
      const msg = this.messages.find(m => m.id === this.activeAssistantMsgId);
      if (msg?.content) {
        msg.content = this.cleanResponse(msg.content);
        this.updateMessageHtml(msg);
        const { finalAnswer } = this.extractSections(msg.content);
        this.chatHistory.push({ role: 'assistant', content: finalAnswer });
      }
    }

    this.activeAssistantMsgId = null;
    this.shouldScroll = true;
    this.saveCurrentConv();

    this.zone.run(() => {
      this.isLoading = false;
      this.messages = [...this.messages];
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    });
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  openModal() {
    this.bsModalRef = this.modalService.show(LandingPage, {
      backdrop: 'static', keyboard: false,
      class: 'modal-dialog modal-dialog-centered modal-sm'
    });

    this.bsModalRef.content.onClose.subscribe((res: any) => {
      this.userData = res;
      if (this.userData.type === 'registration') {
        this.registrationbsModalRef = this.modalService.show(Registration, {
          backdrop: 'static', keyboard: false,
          class: 'modal-dialog modal-dialog-centered modal-sm'
        });
        this.registrationbsModalRef.content.onRegistration.subscribe((res: any) => {
          this.registrationData = res.data;
          this.registrationbsModalRef.content.onRegistration.complete();
        });
      }
      this.bsModalRef.content.onClose.complete();
    });
  }

  logout() {
    localStorage.clear();
    window.location.reload();
  }

  private loadUserConversations(): void {
    this.chatService.getConv().subscribe({
      next: (res: any) => {
        const data: Record<string, ConversationState> = res?.data;

        if (!data || Object.keys(data).length === 0) {
          this.newConversation();
          return;
        }

        Object.entries(data).forEach(([id, state]) => {
          const messages = (state.messages ?? []).map(msg => {
            const rich: RichMessage = { ...msg };
            if (rich.content) this.updateMessageHtml(rich);
            return rich;
          });

          this.convStore.set(id, {
            messages,
            chatHistory: state.chatHistory ?? [],
            userPrompts: (state.userPrompts ?? []).map(p => ({
              ...p,
              timestamp: new Date(p.timestamp),
            })),
          });
        });

        this.conversations = Object.entries(data)
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([id, state]) => ({
            id,
            title: (state.messages ?? []).find(m => m.role === 'user')
              ?.content?.slice(0, 40) ?? 'Conversation',
          }));

        const latestId = this.conversations[0].id;
        this.currentConvId = latestId;

        const latest = this.convStore.get(latestId);
        if (latest) {
          this.messages    = [...latest.messages];
          this.chatHistory = [...latest.chatHistory];
          this.userPrompts = [...latest.userPrompts];
        }

        this.shouldScroll = true;
        this.cdr.markForCheck();
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load conversations:', err);
        this.newConversation();
      }
    });
  }

  // ── Logout confirm ────────────────────────────────────────────────────────
  showLogoutConfirm = false;
  deleteConversationdata: any = false;

  toggleAccountMenu(): void {
    this.accountMenuOpen = !this.accountMenuOpen;
  }

  openLogoutConfirm() {
    this.accountMenuOpen = false;
    this.showLogoutConfirm = true;
  }
  confirmLogout() { localStorage.clear(); window.location.reload(); }
  cancelLogout() { this.showLogoutConfirm = false; }

  // ── Delete conversation ───────────────────────────────────────────────────
  deleteConversation(id: string, e: Event): void {
    e.stopPropagation();
    this.deleteConversationdata = id;
  }

  confirmDelete(): void {
    const id = this.deleteConversationdata;
    if (!id) return;

    this.convStore.delete(id);
    this.conversations = this.conversations.filter(c => c.id !== id);

    if (this.currentConvId === id) {
      if (this.conversations.length > 0) {
        this.currentConvId = this.conversations[0].id;
        this.loadConv(this.currentConvId);
      } else {
        this.deleteConversationdata = false;
        this.newConversation();
        return;
      }
    }

    this.deleteConversationdata = false;
    this.saveCurrentConv();
  }

  cancelDelete(): void {
    this.deleteConversationdata = false;
  }
}
