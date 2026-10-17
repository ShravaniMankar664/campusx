import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import * as gatewayModule from '@/lib/campusx';
import type { Activity, CampusXGateway, DashboardStats, Issue, IssueStatus, Severity, WalletState } from '@/lib/campusx-types';
import {
  Activity as ActivityIcon, ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, Blocks, Check,
  CheckCircle2, ChevronDown, CircleAlert, ClipboardCheck, Clock3, ExternalLink, FileCheck2, Filter,
  Fingerprint, Gauge, Hash, Info, Landmark, Link2, ListFilter, LoaderCircle, LockKeyhole, MapPin,
  Menu, Plus, Radio, RefreshCw, Search, Shield, ShieldCheck, ThumbsUp, TriangleAlert, Wallet, Wrench, X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const gateway = gatewayModule as unknown as CampusXGateway;
const SEPOLIA_CHAIN_ID = 11155111;
const explorer = 'https://sepolia.etherscan.io';

type TxState = { status: 'idle' | 'pending' | 'confirmed' | 'rejected' | 'error'; message?: string; hash?: string };

function shortAddress(address?: string) {
  if (!address) return 'Not connected';
  return /^0x[a-fA-F0-9]{40}$/.test(address)
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}
function dateLabel(value?: number | string) {
  if (!value) return 'Timestamp unavailable';
  const date = typeof value === 'number' ? new Date(value > 1e12 ? value : value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function statusKey(status: IssueStatus | string) {
  return status.toLowerCase().replace(/[^a-z]/g, '');
}
function priorityScore(issue: Issue) {
  const severityRank: Record<Severity, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  return severityRank[issue.severity] * 10 + issue.voteCount;
}
function useProtocol() {
  const [wallet, setWallet] = useState<WalletState>({ isConnected: false, isAdministrator: false, isResolver: false });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [walletError, setWalletError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const contractConfigured = gateway.isContractConfigured();

  useEffect(() => {
    let active = true;
    if (!contractConfigured) {
      setIssues([]);
      setStats(null);
      setError('The CAMPUSX Sepolia contract is not configured yet. Deploy the contract and set VITE_CAMPUSX_CONTRACT_ADDRESS.');
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    Promise.all([gateway.getIssues(), gateway.getDashboardStats()])
      .then(([list, summary]) => {
        if (!active) return;
        setIssues(list);
        setStats(summary);
        setError('');
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not read the Sepolia contract.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, contractConfigured]);

  useEffect(() => gateway.subscribeWallet((next) => {
    setWallet(next);
    setRefresh((value) => value + 1);
  }), []);

  async function connect() {
    try {
      const connected = await gateway.connectWallet();
      const [admin, resolver] = connected.address && connected.chainId === SEPOLIA_CHAIN_ID && contractConfigured
        ? await Promise.all([gateway.isAdministrator(connected.address), gateway.isResolver(connected.address)])
        : [false, false];
      setWallet({ ...connected, isAdministrator: admin, isResolver: resolver });
      setWalletError('');
    } catch (reason) {
      setWalletError(reason instanceof Error ? reason.message : 'Wallet connection failed.');
      throw reason;
    }
  }
  return { wallet, setWallet, issues, stats, loading, error, walletError, setWalletError, contractConfigured, reload: () => setRefresh((v) => v + 1), connect };
}

function useTransaction() {
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  async function run<T extends { transactionHash: string }>(action: () => Promise<T>, success: string) {
    setTx({ status: 'pending', message: 'Waiting for wallet approval and Sepolia confirmation…' });
    try {
      const result = await action();
      setTx({ status: 'confirmed', message: success, hash: result.transactionHash });
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Transaction could not be completed.';
      setTx({ status: /reject|denied|cancel/i.test(message) ? 'rejected' : 'error', message });
      return null;
    }
  }
  return { tx, run, clear: () => setTx({ status: 'idle' }) };
}

function TxNotice({ tx }: { tx: TxState }) {
  if (tx.status === 'idle') return null;
  const Icon = tx.status === 'pending' ? LoaderCircle : tx.status === 'confirmed' ? CheckCircle2 : tx.status === 'rejected' ? CircleAlert : TriangleAlert;
  return <div className={`tx-notice ${tx.status}`} role="status" data-testid="status-transaction">
    <Icon size={17} className={tx.status === 'pending' ? 'spin' : ''} />
    <span>{tx.message}</span>
    {tx.hash && <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13} /></a>}
  </div>;
}

function StatusPill({ status }: { status: IssueStatus | string }) {
  return <span className={`status-pill status-${statusKey(status)}`}><i />{status.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>;
}

function AppShell({ children, protocol }: { children: ReactNode; protocol: ReturnType<typeof useProtocol> }) {
  const [path] = useLocation();
  const [mobileMenu, setMobileMenu] = useState(false);
  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Gauge },
    { href: '/issues', label: 'Issue explorer', icon: ListFilter },
    { href: '/report', label: 'Submit an issue', icon: Plus },
    { href: '/resolver', label: 'Resolver workspace', icon: Wrench },
    { href: '/authority', label: 'Authority console', icon: Landmark },
    { href: '/about', label: 'Protocol guide', icon: Info },
  ];
  const isHome = path === '/';
  const currentTitle = navItems.find((item) => item.href === path)?.label || (path.startsWith('/issues/') ? 'Issue record' : 'CAMPUSX');
  return <div className={`app-shell ${isHome ? 'home-shell' : ''}`}>
    <header className="topbar">
      <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><Blocks size={19} /></span><span>CAMPUS<span className="brand-x">X</span><small>ACCOUNTABILITY PROTOCOL</small></span></Link>
      <nav className="top-nav" aria-label="Primary navigation">
        {navItems.slice(0, 3).map((item) => <Link key={item.href} href={item.href} className={path === item.href ? 'top-link active' : 'top-link'}>{item.label}</Link>)}
      </nav>
      <div className="top-actions">
        <span className={`network-tag ${protocol.wallet.chainId === SEPOLIA_CHAIN_ID ? 'online' : ''}`}><span />{protocol.contractConfigured ? ' Sepolia' : ' Sepolia · deployment pending'}</span>
        <button className="wallet-button" onClick={() => {
          const action = protocol.wallet.isConnected && protocol.wallet.chainId !== SEPOLIA_CHAIN_ID
            ? gateway.switchToSepolia().then(() => protocol.connect())
            : protocol.connect();
          action.catch((reason) => protocol.setWalletError(reason instanceof Error ? reason.message : 'Wallet request failed.'));
        }} data-testid="button-connect-wallet"><Wallet size={16} />{protocol.wallet.isConnected ? protocol.wallet.chainId === SEPOLIA_CHAIN_ID ? shortAddress(protocol.wallet.address) : 'Switch to Sepolia' : 'Connect wallet'}</button>
        <button className="mobile-toggle" onClick={() => setMobileMenu((open) => !open)} aria-label="Toggle navigation" data-testid="button-mobile-menu">{mobileMenu ? <X /> : <Menu />}</button>
      </div>
    </header>
    {protocol.walletError && <div className="wallet-error" role="alert"><TriangleAlert size={15} />{protocol.walletError}</div>}
    {mobileMenu && <div className="mobile-nav">{navItems.map((item) => <Link key={item.href} href={item.href} onClick={() => setMobileMenu(false)}><item.icon size={16} />{item.label}</Link>)}</div>}
    {!isHome && <div className="app-frame">
      <aside className="side-rail">
        <div className="rail-label">WORKSPACE</div>
        {navItems.map((item) => <Link key={item.href} href={item.href} className={`rail-link ${path === item.href ? 'selected' : ''}`}><item.icon size={17} /><span>{item.label}</span>{path === item.href && <span className="rail-active" />}</Link>)}
        <div className="rail-bottom">
          <div className="chain-mini"><span className="chain-light" /><div><b>Ethereum Sepolia</b><small>Public test network</small></div></div>
          <div className="rail-footnote">VERIFIABLE BY DESIGN<br /><span>Issues and status changes are on-chain.</span></div>
        </div>
      </aside>
      <main className="main-panel">
        <div className="page-context"><span className="context-root">CAMPUSX</span><span className="context-slash">/</span><span>{currentTitle}</span><span className="context-live"><i />{protocol.contractConfigured ? ' LIVE CONTRACT DATA' : ' DEPLOYMENT PENDING'}</span></div>
        {children}
      </main>
    </div>}
    {isHome && <main>{children}</main>}
    <footer className="site-footer"><div className="footer-brand"><Blocks size={15} /> CAMPUSX <span>·</span> SEPOLIA</div><div>Public accountability. Reporter names stay off the interface.</div><Link href="/about">Read the protocol guide <ArrowRight size={13} /></Link></footer>
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

function HomePage({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const stats = protocol.stats;
  return <div className="landing">
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-line" />A PUBLIC CAMPUS WORKFLOW</div>
        {!protocol.contractConfigured && <div className="deployment-pending" role="status"><TriangleAlert size={14} /><span><b>Sepolia deployment pending.</b> Live reads and writes are unavailable until the contract address is configured. No sample incidents are shown.</span></div>}
        <h1>Make campus<br /><em>issues</em> impossible<br />to ignore.</h1>
        <p>Report without displaying a name in the app. Track the response publicly. Every assignment, repair commitment, and resolution leaves a verifiable trail.</p>
        <div className="hero-actions"><Link href="/report" className="button button-primary">Report an issue <ArrowRight size={16} /></Link><Link href="/issues" className="button button-ghost">Explore issue log <ArrowDownRight size={16} /></Link></div>
        <div className="hero-assurance"><ShieldCheck size={16} /><span>Reporter identity is never displayed in the public interface.</span></div>
      </div>
      <div className="hero-visual">
        <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
        <div className="protocol-card">
          <div className="protocol-head"><div className="protocol-symbol"><Blocks size={19} /></div><span>INCIDENT LIFECYCLE</span><span className="protocol-live"><i />{protocol.contractConfigured ? ' ON-CHAIN' : ' DEPLOYMENT PENDING'}</span></div>
          <div className="flowline">
            <div className="flow-step completed"><div className="flow-dot"><Fingerprint size={16} /></div><span>Report</span><small>Name not displayed</small></div>
            <div className="flow-step completed"><div className="flow-dot"><ClipboardCheck size={16} /></div><span>Assign</span><small>Authority action</small></div>
            <div className="flow-step current"><div className="flow-dot"><Wrench size={16} /></div><span>Repair</span><small>Commitment logged</small></div>
            <div className="flow-step"><div className="flow-dot"><BadgeCheck size={16} /></div><span>Verify</span><small>Community review</small></div>
          </div>
          <div className="protocol-foot"><span>Each state transition</span><b><Link2 size={13} /> Ethereum event</b></div>
        </div>
        <div className="hero-code"><span>PROOF / 001</span><strong>Transparency<br />without exposure.</strong><div className="code-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
          <div className="floating-stamp"><Shield size={17} /><div>PUBLIC BY DEFAULT<small>NO REPORTER NAME IN THE UI</small></div></div>
      </div>
      <div className="hero-edge"><span>BUILT FOR CAMPUS TEAMS</span><span>01 — 04 / REPORT · ASSIGN · REPAIR · VERIFY</span></div>
    </section>
    <section className="landing-stats">
      <div className="landing-stat-intro"><span className="eyebrow">THE LEDGER, NOT THE PROMISE</span><p>Only confirmed contract data appears here.</p></div>
      <StatValue label="Issues recorded" value={stats ? stats.totalIssues : '—'} detail="Sepolia contract" loading={protocol.loading} />
      <StatValue label="In active workflow" value={stats ? stats.openIssues + stats.inProgress : '—'} detail="Open + in progress" loading={protocol.loading} />
      <StatValue label="Resolutions logged" value={stats ? stats.resolved : '—'} detail="Confirmed on-chain" loading={protocol.loading} />
      <Link href="/dashboard" className="stats-link">View live dashboard <ArrowRight size={15} /></Link>
    </section>
    <section className="landing-explainer">
      <div className="explainer-title"><div className="eyebrow">A SHARED RECORD, NOT A MESSAGE BOARD</div><h2>Accountability has<br />a traceable path.</h2><p>CampusX connects the person reporting a problem, the team responsible, and the people verifying the outcome through one public workflow.</p><Link href="/about" className="text-link">How the protocol works <ArrowRight size={15} /></Link></div>
      <div className="explainer-steps">
        {[
          ['01', 'A student reports', 'Location and details help teams act. The reporting address is never shown publicly.', Fingerprint],
          ['02', 'A team takes ownership', 'Authorized campus staff assign a resolver and move the issue forward.', Landmark],
          ['03', 'The work is recorded', 'A repair note and required evidence-file commitment become inspectable contract events.', Hash],
          ['04', 'The outcome is reviewed', 'Resolution, dispute, and reopening are explicit actions—not silent edits.', BadgeCheck],
        ].map(([num, title, body, Icon]) => <div className="explainer-step" key={String(num)}><div className="step-num">{String(num)}</div><div className="step-icon"><Icon size={18} /></div><div><h3>{String(title)}</h3><p>{String(body)}</p></div><ArrowUpRight size={15} className="step-arrow" /></div>)}
      </div>
    </section>
    <section className="landing-bottom-cta"><div><span className="eyebrow">START WITH WHAT NEEDS FIXING</span><h2>A better campus begins<br />with a record.</h2></div><Link href="/report" className="button button-primary">Submit an issue <ArrowRight size={16} /></Link><span className="cta-mark">CX<span>/</span>01</span></section>
    {protocol.error && <div className="global-read-error"><TriangleAlert size={16} />{protocol.error}</div>}
  </div>;
}

function StatValue({ label, value, detail, loading }: { label: string; value: string | number; detail: string; loading: boolean }) {
  return <div className="landing-stat"><span>{label}</span><strong>{loading ? <i className="skeleton-value" /> : value}</strong><small>{detail}</small></div>;
}

function DashboardPage({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const { stats, issues, loading, error, reload, wallet } = protocol;
  return <div className="page-wrap">
    <PageHeading eyebrow="NETWORK PULSE / SEPOLIA" title="The campus ledger." description="A live view of issues and outcomes recorded by the CAMPUSX contract." action={<button className="button button-outline" onClick={reload} data-testid="button-refresh-dashboard"><RefreshCw size={15} />Refresh data</button>} />
    {error && <ReadError message={error} retry={reload} />}
    <div className="metric-grid">
      <Metric label="Total incidents" value={stats?.totalIssues} icon={Blocks} accent="blue" loading={loading} />
      <Metric label="Awaiting action" value={stats?.openIssues} icon={Clock3} accent="violet" loading={loading} />
      <Metric label="High severity" value={stats?.highPriority} icon={TriangleAlert} accent="amber" loading={loading} />
      <Metric label="Work underway" value={stats?.inProgress} icon={Wrench} accent="cyan" loading={loading} />
      <Metric label="Awaiting reporter" value={stats?.awaitingVerification} icon={ClipboardCheck} accent="violet" loading={loading} />
      <Metric label="Resolved" value={stats?.resolved} icon={BadgeCheck} accent="green" loading={loading} />
      <Metric label="Disputed" value={stats?.disputed} icon={CircleAlert} accent="amber" loading={loading} />
    </div>
    <div className="dashboard-grid">
      <section className="panel ledger-panel">
        <div className="panel-heading"><div><span className="eyebrow">LATEST RECORDS</span><h2>Issue activity</h2></div><Link href="/issues" className="text-link small">Full explorer <ArrowRight size={14} /></Link></div>
        {loading ? <SkeletonRows /> : issues.length ? <div className="issue-list compact">{issues.slice(0, 5).map((issue) => <IssueRow key={issue.id} issue={issue} />)}</div> : <EmptyState title="No incidents recorded yet" body="When an issue is created on the Sepolia contract, it will appear here. No sample records are shown." icon={Blocks} />}
      </section>
      <section className="panel network-panel">
        <div className="panel-heading"><div><span className="eyebrow">NETWORK STATUS</span><h2>Contract connection</h2></div><span className="network-pip"><i /> LIVE READ</span></div>
        <div className="network-diagram"><div className="network-node app-node"><Blocks size={20} /><span>CAMPUSX</span></div><div className="network-wire"><i /><i /><i /></div><div className="network-node chain-node"><span className="eth-diamond">◇</span><span>SEPOLIA</span></div></div>
        <div className="network-details"><div><span>Wallet</span><b>{wallet.isConnected ? shortAddress(wallet.address) : 'Not connected'}</b></div><div><span>Chain</span><b>{wallet.chainId === SEPOLIA_CHAIN_ID ? 'Sepolia · 11155111' : 'No wallet session'}</b></div><div><span>Latest block</span><b className="mono">{stats?.latestBlock ? `#${stats.latestBlock.toLocaleString()}` : '—'}</b></div></div>
        <div className="info-note"><Info size={15} /><span>Dashboard data is read directly from the contract. A failed read is never replaced with illustrative data.</span></div>
      </section>
    </div>
    <section className="panel audit-preview"><div className="panel-heading"><div><span className="eyebrow">PROTOCOL PRINCIPLE</span><h2>Public actions. Private identity.</h2></div><Link href="/about" className="text-link small">Privacy details <ArrowRight size={14} /></Link></div><div className="principle-row"><Principle icon={Fingerprint} title="No public reporter identity" text="The interface deliberately omits reporter addresses." /><Principle icon={Radio} title="Events are inspectable" text="Action history links to public Sepolia transactions." /><Principle icon={ShieldCheck} title="Evidence is a commitment" text="A hash can match a file; it cannot prove what happened." /></div></section>
  </div>;
}

function Metric({ label, value, icon: Icon, accent, loading }: { label: string; value?: number; icon: typeof Blocks; accent: string; loading: boolean }) {
  return <div className={`metric-card metric-${accent}`}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={17} /></span></div><strong>{loading ? <i className="skeleton-value" /> : value ?? '—'}</strong><small>Confirmed contract count</small></div>;
}
function Principle({ icon: Icon, title, text }: { icon: typeof Blocks; title: string; text: string }) {
  return <div className="principle"><div className="principle-icon"><Icon size={17} /></div><h3>{title}</h3><p>{text}</p></div>;
}
function ReadError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="read-error"><TriangleAlert size={18} /><div><strong>Contract data unavailable</strong><p>{message}</p></div><button className="button button-outline" onClick={retry} data-testid="button-retry-read">Retry <RefreshCw size={14} /></button></div>;
}
function SkeletonRows() {
  return <div className="skeleton-list" aria-label="Loading contract records"><i /><i /><i /></div>;
}
function EmptyState({ title, body, icon: Icon = Blocks, action }: { title: string; body: string; icon?: typeof Blocks; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={21} /></div><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function IssueRow({ issue }: { issue: Issue }) {
  return <Link href={`/issues/${issue.id}`} className="issue-row" data-testid={`link-issue-${issue.id}`}>
    <div className="issue-row-main"><div className="issue-id">CX-{String(issue.id).padStart(4, '0')}</div><div><h3>{issue.title}</h3><span className="issue-meta"><span>{issue.category}</span><i />{issue.location}<i />{dateLabel(issue.createdAt)}</span></div></div>
    <div className="issue-row-side"><StatusPill status={issue.status} /><span className={`severity severity-${issue.severity.toLowerCase()}`}>{issue.severity}</span><span className="priority-score" title="Priority = severity rank × 10 + on-chain votes">{priorityScore(issue)}</span><span className="votes"><ThumbsUp size={13} />{issue.voteCount}</span><ArrowRight size={15} className="row-arrow" /></div>
  </Link>;
}

function IssuesPage({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All statuses');
  const [category, setCategory] = useState('All categories');
  const [sort, setSort] = useState('priority');
  const filtered = useMemo(() => protocol.issues.filter((issue) => {
    const text = `${issue.title} ${issue.description} ${issue.location} ${issue.category}`.toLowerCase();
    return text.includes(search.toLowerCase()) && (status === 'All statuses' || issue.status === status) && (category === 'All categories' || issue.category === category);
  }).sort((a, b) => sort === 'newest'
    ? Number(b.createdAt) - Number(a.createdAt)
    : priorityScore(b) - priorityScore(a)), [protocol.issues, search, status, category, sort]);
  const categories = useMemo(() => Array.from(new Set(protocol.issues.map((i) => i.category))).sort(), [protocol.issues]);
  return <div className="page-wrap">
    <PageHeading eyebrow="PUBLIC ISSUE REGISTER" title="Issue explorer." description="Search the contract record, inspect status, and follow each issue's audit trail." action={<Link href="/report" className="button button-primary"><Plus size={16} />Report issue</Link>} />
    {protocol.error && <ReadError message={protocol.error} retry={protocol.reload} />}
    <div className="filter-bar">
      <label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by issue, place, or detail…" aria-label="Search issues" data-testid="input-search-issues" /></label>
      <label className="select-field"><Filter size={15} /><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" data-testid="select-issue-status">{['All statuses', 'Submitted', 'Assigned', 'InProgress', 'RepairSubmitted', 'Resolved', 'Disputed', 'Reopened'].map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
      <label className="select-field"><select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" data-testid="select-issue-category"><option>All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
      <label className="select-field"><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort issues" data-testid="select-issue-sort"><option value="priority">Priority score</option><option value="newest">Newest first</option></select><ChevronDown size={14} /></label>
      <span className="result-count">{protocol.loading ? 'Reading ledger…' : `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`}</span>
    </div>
    <div className="priority-explainer">Priority score = severity rank (Low 1 → Critical 4) × 10 + on-chain votes. This is a triage aid, not an emergency override.</div>
    <section className="panel issue-explorer">
      <div className="list-header"><span>ISSUE / LOCATION</span><span>STATUS</span><span>SEVERITY</span><span>PRIORITY</span><span>SUPPORT</span></div>
      {protocol.loading ? <SkeletonRows /> : filtered.length ? <div className="issue-list">{filtered.map((issue) => <IssueRow key={issue.id} issue={issue} />)}</div> : <EmptyState title={protocol.issues.length ? 'No matching issues' : 'The register is clear—for now.'} body={protocol.issues.length ? 'Try changing your search terms or filters.' : 'No contract records are available. Newly confirmed reports will appear here; no sample incidents are inserted.'} icon={Search} action={protocol.issues.length ? <button className="text-link" onClick={() => { setSearch(''); setStatus('All statuses'); setCategory('All categories'); }}>Clear filters</button> : <Link href="/report" className="button button-primary">Submit first report <ArrowRight size={15} /></Link>} />}
    </section>
    <div className="list-footnote"><ShieldCheck size={15} />Public issue records never include reporter identity. Data is read from the current Sepolia contract.</div>
  </div>;
}

function IssueDetailPage({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const params = useParams<{ id: string }>();
  const id = params.id || '';
  const [refresh, setRefresh] = useState(0);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [disputeReason, setDisputeReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { tx, run } = useTransaction();
  useEffect(() => {
    let live = true;
    if (!protocol.contractConfigured) {
      setIssue(null);
      setActivity([]);
      setError('The CAMPUSX Sepolia contract is not configured yet. Deploy the contract and set VITE_CAMPUSX_CONTRACT_ADDRESS.');
      setLoading(false);
      return () => { live = false; };
    }
    setLoading(true);
    Promise.all([gateway.getIssue(id), gateway.getIssueActivity(id)])
      .then(([entry, events]) => { if (live) { setIssue(entry); setActivity(events); setError(''); } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Issue could not be loaded.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, refresh, protocol.contractConfigured]);
  const canVote = protocol.wallet.isConnected && protocol.wallet.chainId === SEPOLIA_CHAIN_ID && protocol.contractConfigured;
  const voteReason = !protocol.contractConfigured ? 'Contract deployment and address configuration are still pending.' : !protocol.wallet.isConnected ? 'Connect a wallet to support this issue.' : protocol.wallet.chainId !== SEPOLIA_CHAIN_ID ? 'Switch to Sepolia to submit a vote.' : '';
  const isReporter = Boolean(protocol.wallet.address && issue?.reporter && protocol.wallet.address.toLowerCase() === issue.reporter.toLowerCase());
  const canReview = isReporter && protocol.wallet.chainId === SEPOLIA_CHAIN_ID && protocol.contractConfigured;
  const vote = async () => { const done = await run(() => gateway.voteForIssue(id), 'Your support was recorded on-chain.'); if (done) protocol.reload(); };
  if (loading) return <div className="page-wrap"><PageHeading eyebrow={`ISSUE / CX-${id}`} title="Loading issue record…" description="Reading issue data and event history from Ethereum Sepolia." /><div className="panel loading-detail"><i /><i /><i /></div></div>;
  if (!issue) return <div className="page-wrap"><PageHeading eyebrow={`ISSUE / CX-${id}`} title="Record unavailable." description="This issue could not be read from the connected contract." />{error && <ReadError message={error} retry={() => setRefresh((value) => value + 1)} />}<Link href="/issues" className="button button-outline">Back to issue explorer</Link></div>;
  return <div className="page-wrap">
    <div className="back-line"><Link href="/issues"><ArrowDownRight size={14} />Issue explorer</Link><span>/</span><span>CX-{String(issue.id).padStart(4, '0')}</span></div>
    <div className="detail-hero"><div className="detail-copy"><div className="eyebrow">ISSUE RECORD / CX-{String(issue.id).padStart(4, '0')}</div><h1>{issue.title}</h1><div className="detail-pills"><StatusPill status={issue.status} /><span className={`severity severity-${issue.severity.toLowerCase()}`}>{issue.severity} priority</span><span className="category-pill">{issue.category}</span></div><p>{issue.description}</p></div><div className="detail-meta"><div><MapPin size={15} /><span>{issue.location}</span></div><div><Clock3 size={15} /><span>Reported {dateLabel(issue.createdAt)}</span></div><div><ThumbsUp size={15} /><span>{issue.voteCount} community {issue.voteCount === 1 ? 'support' : 'supporters'}</span></div><div className="identity-note"><LockKeyhole size={14} /><span>Reporter identity is not part of this public record.</span></div></div></div>
    <TxNotice tx={tx} />
    <div className="detail-grid">
      <div className="detail-main">
        {issue.repairDescription && <section className="panel repair-panel"><div className="panel-heading"><div><span className="eyebrow">RESOLVER COMMITMENT</span><h2>Repair details</h2></div><StatusPill status={issue.status} /></div><p>{issue.repairDescription}</p>{issue.evidenceHash && <div className="hash-box"><Hash size={15} /><div><span>Evidence SHA-256 commitment</span><code>{issue.evidenceHash}</code></div></div>}<div className="evidence-caveat"><Info size={14} />A matching hash does not authenticate the image or prove that a repair occurred.</div></section>}
        {issue.status === 'RepairSubmitted' && <section className="panel verification-card"><div className="panel-heading"><div><span className="eyebrow">REPORTER DECISION</span><h2>Review the proposed resolution</h2></div><BadgeCheck size={18} /></div><p>Only the wallet that created this report can confirm or dispute this repair commitment. Confirmation records the reporter's decision; it does not independently verify physical work.</p>{isReporter ? <><label className="form-label">Dispute reason<textarea rows={3} minLength={5} maxLength={500} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} placeholder="If the issue remains, explain what still needs attention." /></label><div className="button-pair"><button className="button button-primary" disabled={!canReview || tx.status === 'pending'} title={!canReview ? 'Switch to Sepolia to submit this decision.' : ''} onClick={() => run(() => gateway.confirmResolution(id), 'Reporter confirmation recorded on-chain.').then((done) => { if (done) { protocol.reload(); setRefresh((value) => value + 1); } })}><Check size={14} />Confirm resolution</button><button className="button button-danger" disabled={!canReview || tx.status === 'pending' || disputeReason.trim().length < 5} title={!canReview ? 'Switch to Sepolia to submit this decision.' : disputeReason.trim().length < 5 ? 'Enter at least 5 characters to dispute.' : ''} onClick={() => run(() => gateway.disputeResolution(id, disputeReason), 'Reporter dispute recorded on-chain.').then((done) => { if (done) { protocol.reload(); setRefresh((value) => value + 1); } })}><CircleAlert size={14} />Dispute repair</button></div></> : <div className="evidence-caveat"><LockKeyhole size={14} />Connect the original reporting wallet on Sepolia to confirm or dispute. Its address is not displayed here.</div>}</section>}
        <section className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">ETHEREUM EVENT HISTORY</span><h2>Audit trail <span className="event-count">{activity.length}</span></h2></div><span className="network-pip"><i /> PUBLIC</span></div>
          {!activity.length ? <EmptyState title="No event history returned" body="Contract activity is unavailable for this record at the moment. No events are fabricated." icon={ActivityIcon} /> : <div className="timeline">{activity.map((event, i) => <div className="timeline-event" key={`${event.transactionHash}-${i}`}><div className="timeline-rail"><span className="timeline-dot"><ActivityIcon size={13} /></span>{i < activity.length - 1 && <i />}</div><div className="timeline-content"><div className="timeline-top"><b>{event.eventName}</b><time>{dateLabel(event.timestamp)}</time></div><p>{event.summary}</p><div className="event-meta"><span>Block <b>#{event.blockNumber.toLocaleString()}</b></span><span>Actor <code>{shortAddress(event.actor)}</code></span><a href={`${explorer}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">Transaction <ExternalLink size={12} /></a></div><code className="tx-hash">{event.transactionHash}</code></div></div>)}</div>}
        </section>
      </div>
      <aside className="detail-aside">
        <section className="panel support-card"><span className="eyebrow">COMMUNITY SIGNAL</span><div className="support-number">{issue.voteCount}<small>support</small></div><p>Support flags priority to the campus team. It does not change the issue description or status.</p><button className="button button-primary full-button" disabled={!canVote || tx.status === 'pending'} title={!canVote ? voteReason : ''} onClick={vote} data-testid="button-vote-issue"><ThumbsUp size={15} />Support this issue</button>{!canVote && <small className="disabled-reason">{voteReason}</small>}</section>
        <section className="panel assignment-card"><span className="eyebrow">OWNERSHIP</span><div className="assignment-row"><span>Responsible team</span><b>{issue.team || 'Not assigned'}</b></div><div className="assignment-row"><span>Resolver</span><b>{issue.assignedResolver ? shortAddress(issue.assignedResolver) : 'Awaiting assignment'}</b></div><div className="assignment-row"><span>Repair submitted</span><b>{issue.repairSubmittedAt ? dateLabel(issue.repairSubmittedAt) : 'Not yet'}</b></div><Link href="/authority" className="text-link small">Authority actions <ArrowRight size={14} /></Link></section>
      </aside>
    </div>
  </div>;
}

function ReportPage({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const { tx, run } = useTransaction();
  const [form, setForm] = useState({ title: '', description: '', category: 'IT & Laboratory Equipment', location: '', severity: 'Medium' as Severity });
  const [createdIssueId, setCreatedIssueId] = useState('');
  const ready = protocol.wallet.isConnected && protocol.wallet.chainId === SEPOLIA_CHAIN_ID && protocol.contractConfigured;
  const reason = !protocol.contractConfigured ? 'Contract deployment and address configuration are still pending.' : !protocol.wallet.isConnected ? 'Connect a wallet to authorize this transaction.' : protocol.wallet.chainId !== SEPOLIA_CHAIN_ID ? 'Switch your wallet to Ethereum Sepolia.' : '';
  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = await run(() => gateway.createIssue(form), 'Issue confirmed on the Sepolia contract.');
    if (result) { protocol.reload(); setCreatedIssueId(result.issueId || ''); setForm({ title: '', description: '', category: 'IT & Laboratory Equipment', location: '', severity: 'Medium' }); }
  }
  return <div className="page-wrap report-layout">
    <div><PageHeading eyebrow="NEW CONTRACT RECORD" title="Report an issue." description="Give the campus team enough detail to locate and act. Your reporting address is used for contract authorization and is never displayed as a public identity." />
      <div className="privacy-card"><div className="privacy-icon"><Fingerprint size={19} /></div><div><b>Private reporter. Public incident.</b><p>Issue details, status changes, and transaction history are inspectable. The interface does not display your reporter address. Blockchain transactions are public and addresses may be linkable outside this app.</p></div></div>
    </div>
    <form className="panel report-form" onSubmit={submit}>
      <div className="form-top"><div><span className="eyebrow">INCIDENT DETAILS</span><h2>What needs attention?</h2></div><span className="required-note">ALL FIELDS REQUIRED</span></div>
      <label className="form-label">Issue title<input required minLength={5} maxLength={80} placeholder="e.g. North library lift out of service" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-issue-title" /></label>
      <label className="form-label">Description<textarea required minLength={10} maxLength={1400} rows={5} placeholder="Describe what is happening and anything that helps the right team respond." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-issue-description" /><small>{form.description.length}/1400 · Avoid personal names or sensitive information.</small></label>
      <div className="form-pair"><label className="form-label">Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="select-issue-category-report">{['IT & Laboratory Equipment', 'Electrical Maintenance', 'Plumbing', 'Campus Infrastructure', 'Network & Wi-Fi', 'Other campus issue'].map((item) => <option key={item}>{item}</option>)}</select></label><label className="form-label">Severity<select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })} data-testid="select-issue-severity">{['Low', 'Medium', 'High', 'Critical'].map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <label className="form-label">Location<input required maxLength={120} placeholder="Building, floor, room, or campus area" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="input-issue-location" /></label>
      <TxNotice tx={tx} />
      {createdIssueId && <div className="created-record"><CheckCircle2 size={17} /><span>Confirmed issue <b>CX-{createdIssueId.padStart(4, '0')}</b> is now on the contract.</span><Link href={`/issues/${createdIssueId}`}>Open record <ArrowRight size={14} /></Link></div>}
      <div className="form-submit"><div><small>Submitting requires a wallet transaction.</small>{!ready && <small className="disabled-reason">{reason}</small>}</div><button className="button button-primary" type="submit" disabled={!ready || tx.status === 'pending'} data-testid="button-submit-issue">{tx.status === 'pending' ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Submit to contract</button></div>
    </form>
  </div>;
}

function ResolverPage({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const [selected, setSelected] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState('');
  const [hashing, setHashing] = useState(false);
  const { tx, run } = useTransaction();
  const work = protocol.issues.filter((issue) => issue.assignedResolver?.toLowerCase() === protocol.wallet.address?.toLowerCase());
  async function selectFile(next: File | null) {
    setFile(next); setHash('');
    if (!next) return;
    setHashing(true);
    try { const bytes = await next.arrayBuffer(); const digest = await crypto.subtle.digest('SHA-256', bytes); setHash(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')); }
    catch { setHash(''); }
    finally { setHashing(false); }
  }
  const ready = protocol.wallet.isConnected && protocol.wallet.chainId === SEPOLIA_CHAIN_ID && protocol.contractConfigured && protocol.wallet.isResolver;
  const blocked = !protocol.contractConfigured ? 'Contract deployment and address configuration are still pending.' : !protocol.wallet.isConnected ? 'Connect a wallet to access resolver actions.' : protocol.wallet.chainId !== SEPOLIA_CHAIN_ID ? 'Switch to Sepolia before submitting transactions.' : !protocol.wallet.isResolver ? 'This wallet is not enabled as a resolver.' : '';
  async function action(fn: () => Promise<{ transactionHash: string }>, success: string) { const done = await run(fn, success); if (done) protocol.reload(); }
  return <div className="page-wrap">
    <PageHeading eyebrow="RESOLVER WORKSPACE" title="Turn assignment into action." description="Advance assigned work, record what was repaired, and commit a required evidence-file hash." />
    {!ready && <div className="role-banner"><Shield size={17} /><div><b>Resolver permissions required</b><p>{blocked}</p></div><RoleWalletActions protocol={protocol} /></div>}
    {protocol.error && <ReadError message={protocol.error} retry={protocol.reload} />}
    <TxNotice tx={tx} />
    <div className="workspace-grid">
      <section className="panel work-list"><div className="panel-heading"><div><span className="eyebrow">ASSIGNED / AVAILABLE</span><h2>Work queue</h2></div><span className="count-tag">{work.length} records</span></div>
        {protocol.loading ? <SkeletonRows /> : work.length ? work.map((issue) => <button className={`work-item ${selected === issue.id ? 'chosen' : ''}`} key={issue.id} onClick={() => setSelected(issue.id)} data-testid={`button-select-work-${issue.id}`}><span className="work-id">CX-{String(issue.id).padStart(4, '0')}</span><strong>{issue.title}</strong><small>{issue.location}</small><StatusPill status={issue.status} /><ArrowRight size={14} /></button>) : <EmptyState title="No resolver work available" body={protocol.wallet.isResolver ? 'No issues are assigned to this resolver yet.' : 'Connect an enabled resolver wallet to see assigned issues.'} icon={Wrench} />}
      </section>
      <section className="panel work-detail">
        {!selected ? <EmptyState title="Select a work item" body="Choose an assigned issue to review its details and available contract actions." icon={ClipboardCheck} /> : (() => {
          const issue = work.find((item) => item.id === selected);
          if (!issue) return <EmptyState title="Issue no longer in queue" body="Refresh the contract records to update this workspace." icon={RefreshCw} />;
          return <><div className="panel-heading"><div><span className="eyebrow">CX-{String(issue.id).padStart(4, '0')} / WORK ITEM</span><h2>{issue.title}</h2></div><StatusPill status={issue.status} /></div><p className="work-description">{issue.description}</p><div className="work-location"><MapPin size={15} />{issue.location}<span>{issue.category}</span></div><div className="work-actions"><h3>Contract actions</h3>{['Assigned', 'Reopened'].includes(issue.status) && <button className="button button-outline full-button" disabled={!ready || tx.status === 'pending'} title={!ready ? blocked : ''} onClick={() => action(() => gateway.setIssueInProgress(issue.id), 'Issue marked in progress.')}><Wrench size={15} />Mark in progress</button>}
            {issue.status === 'InProgress' && <div className="repair-evidence"><label className="form-label">Repair summary<textarea rows={3} minLength={10} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the work completed." data-testid="input-repair-description" /></label><label className="file-picker"><input type="file" accept="image/*,.pdf" onChange={(e) => selectFile(e.target.files?.[0] || null)} data-testid="input-repair-evidence" /><span><FileCheck2 size={16} />{file ? file.name : 'Choose evidence file'}</span><small>{hashing ? 'Calculating SHA-256…' : hash ? 'SHA-256 calculated in this browser' : 'Image or PDF · file itself is not uploaded by this interface'}</small></label>{hash && <div className="hash-box"><Hash size={14} /><code>{hash}</code></div>}<div className="evidence-caveat"><Info size={14} />Hash matching proves file consistency only. It does not authenticate the file or prove a repair occurred.</div><button className="button button-primary full-button" disabled={!ready || description.trim().length < 10 || !hash || tx.status === 'pending' || hashing} title={!ready ? blocked : description.trim().length < 10 ? 'Add a repair summary of at least 10 characters.' : !hash ? 'Choose an evidence file and calculate its hash.' : ''} onClick={() => action(() => gateway.submitRepair(issue.id, description, hash), 'Repair commitment confirmed on-chain.')}><Check size={15} />Submit repair commitment</button></div>}
          </div><Link href={`/issues/${issue.id}`} className="text-link small">Open public audit record <ArrowRight size={14} /></Link></>;
        })()}
      </section>
    </div>
  </div>;
}

function RoleWalletActions({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  return <div className="role-actions">{!protocol.wallet.isConnected ? <button className="button button-outline" onClick={() => protocol.connect().catch((reason) => protocol.setWalletError(reason instanceof Error ? reason.message : 'Wallet request failed.'))}><Wallet size={14} />Connect wallet</button> : protocol.wallet.chainId !== SEPOLIA_CHAIN_ID ? <button className="button button-outline" onClick={() => gateway.switchToSepolia().then(() => protocol.connect()).catch((reason) => protocol.setWalletError(reason instanceof Error ? reason.message : 'Network switch failed.'))}><RefreshCw size={14} />Switch network</button> : null}</div>;
}

function AuthorityPage({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const { tx, run } = useTransaction();
  const [id, setId] = useState('');
  const [resolver, setResolver] = useState('');
  const [resolverAddress, setResolverAddress] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [reopenResolver, setReopenResolver] = useState('');
  const [oversightId, setOversightId] = useState('');
  const selectedAssignment = protocol.issues.find((issue) => issue.id === id);
  const selectedOversight = protocol.issues.find((issue) => issue.id === oversightId);
  const authorized = protocol.wallet.isConnected && protocol.wallet.chainId === SEPOLIA_CHAIN_ID && protocol.contractConfigured && protocol.wallet.isAdministrator;
  const blockReason = !protocol.contractConfigured ? 'Contract deployment and address configuration are still pending.' : !protocol.wallet.isConnected ? 'Connect an administrator wallet to use authority actions.' : protocol.wallet.chainId !== SEPOLIA_CHAIN_ID ? 'Switch to Ethereum Sepolia.' : !protocol.wallet.isAdministrator ? 'Connected wallet does not have administrator permissions.' : '';
  async function submit(e: FormEvent, fn: () => Promise<{ transactionHash: string }>, success: string) { e.preventDefault(); const done = await run(fn, success); if (done) protocol.reload(); }
  return <div className="page-wrap">
    <PageHeading eyebrow="CAMPUS AUTHORITY / ADMIN" title="Steward the workflow." description="Assign ownership, manage resolver permissions, and make dispute outcomes explicit on-chain." />
    {!authorized && <div className="role-banner"><Shield size={17} /><div><b>Administrator permissions required</b><p>{blockReason}</p></div><RoleWalletActions protocol={protocol} /></div>}
    <TxNotice tx={tx} />
    <div className="authority-grid">
      <form className="panel authority-form" onSubmit={(e) => submit(e, () => gateway.assignIssue(id, resolver), 'Issue assignment confirmed.')}>
        <div className="form-top"><div><span className="eyebrow">01 / OWNERSHIP</span><h2>Assign an issue</h2></div><Landmark size={18} /></div>
        <label className="form-label">Issue record<select required value={id} onChange={(e) => setId(e.target.value)} data-testid="select-assign-issue"><option value="">Choose issue…</option>{protocol.issues.filter((issue) => ['Submitted', 'Assigned'].includes(issue.status)).map((issue) => <option key={issue.id} value={issue.id}>CX-{String(issue.id).padStart(4, '0')} · {issue.title}</option>)}</select></label>
        <label className="form-label">Resolver wallet<input required value={resolver} onChange={(e) => setResolver(e.target.value)} placeholder="0x…" pattern="^0x[a-fA-F0-9]{40}$" data-testid="input-assignment-resolver" /></label>
        <p className="form-help">Category-routed team: <b>{selectedAssignment?.team || 'Choose an issue to see its on-chain team route.'}</b> The contract retains this routing when a resolver is assigned.</p>
        <button className="button button-primary full-button" disabled={!authorized || tx.status === 'pending'} title={!authorized ? blockReason : ''}><ArrowRight size={15} />Assign issue</button>
      </form>
      <form className="panel authority-form" onSubmit={(e) => submit(e, () => gateway.setResolver(resolverAddress, enabled), `Resolver permission ${enabled ? 'granted' : 'revoked'}.`)}>
        <div className="form-top"><div><span className="eyebrow">02 / PERMISSIONS</span><h2>Resolver access</h2></div><ShieldCheck size={18} /></div>
        <label className="form-label">Resolver wallet<input required value={resolverAddress} onChange={(e) => setResolverAddress(e.target.value)} placeholder="0x…" pattern="^0x[a-fA-F0-9]{40}$" data-testid="input-resolver-address" /></label>
        <label className="form-label">Permission<select value={enabled ? 'enable' : 'disable'} onChange={(e) => setEnabled(e.target.value === 'enable')} data-testid="select-resolver-permission"><option value="enable">Enable resolver</option><option value="disable">Revoke resolver</option></select></label>
        <p className="form-help">Resolver access is a contract permission, not a public profile.</p>
        <button className="button button-outline full-button" disabled={!authorized || tx.status === 'pending'} title={!authorized ? blockReason : ''}><Shield size={15} />Apply permission change</button>
      </form>
      <section className="panel authority-form dispute-form">
        <div className="form-top"><div><span className="eyebrow">03 / DISPUTE OVERSIGHT</span><h2>Reopen a disputed issue</h2></div><TriangleAlert size={18} /></div>
        <label className="form-label">Disputed issue<select value={oversightId} onChange={(e) => setOversightId(e.target.value)} data-testid="select-oversight-issue"><option value="">Choose issue…</option>{protocol.issues.filter((issue) => issue.status === 'Disputed').map((issue) => <option key={issue.id} value={issue.id}>CX-{String(issue.id).padStart(4, '0')} · {issue.title}</option>)}</select></label>
        <label className="form-label">Authorized resolver wallet<input value={reopenResolver} onChange={(e) => setReopenResolver(e.target.value)} placeholder="0x…" pattern="^0x[a-fA-F0-9]{40}$" data-testid="input-reopen-resolver" /></label>
        <p className="form-help">Resolution confirmation or dispute is restricted to the original reporter. Authority actions can inspect the record and reopen a dispute for a new repair cycle.</p>
        <button className="button button-outline full-button" disabled={!authorized || tx.status === 'pending' || selectedOversight?.status !== 'Disputed' || !reopenResolver} title={!authorized ? blockReason : selectedOversight?.status !== 'Disputed' ? 'Choose a disputed issue to reopen.' : !reopenResolver ? 'Enter an authorized resolver wallet.' : ''} onClick={() => run(() => gateway.reopenIssue(oversightId, reopenResolver), 'Issue reopened for reinspection on-chain.').then((v) => v && protocol.reload())}><RefreshCw size={14} />Reopen for reinspection</button>
      </section>
    </div>
    <section className="panel authority-register"><div className="panel-heading"><div><span className="eyebrow">CONTRACT REGISTER</span><h2>Issues requiring oversight</h2></div><span className="count-tag">{protocol.issues.length} total</span></div>{protocol.issues.length ? <div className="issue-list compact">{protocol.issues.filter((issue) => issue.status !== 'Resolved').map((issue) => <IssueRow key={issue.id} issue={issue} />)}</div> : <EmptyState title="No issue records available" body="Authority workflows operate on contract issues only. There are no illustrative records." icon={Landmark} />}</section>
  </div>;
}

function AboutPage() {
  return <div className="page-wrap about-page">
    <PageHeading eyebrow="PROTOCOL GUIDE" title="Trust through a better record." description="CAMPUSX gives campus incident workflows a public, verifiable history—without turning reporting into a public identity." />
    <section className="about-banner"><div className="about-banner-icon"><Blocks size={23} /></div><div><span className="eyebrow">ETHEREUM SEPOLIA / TEST NETWORK</span><h2>Accountability is a workflow,<br />not a feed.</h2><p>Every meaningful state change has an accountable actor and an inspectable transaction. The public record is for tracking work, not naming reporters.</p></div><div className="about-index">CX<br /><b>01</b></div></section>
    <div className="about-grid">
      <section className="panel about-section"><span className="eyebrow">HOW A RECORD MOVES</span><h2>From report to resolution.</h2><div className="about-flow">{[['Report', 'A student submits issue details and location through a wallet-authorized transaction.'], ['Assign', 'An administrator assigns a responsible team and an enabled resolver.'], ['In progress', 'The resolver records when work begins.'], ['Repair submitted', 'A repair summary and SHA-256 evidence commitment are recorded.'], ['Review', 'Only the original reporter confirms or disputes; an administrator may reopen a dispute for reinspection.']].map(([title, body], index) => <div className="about-flow-item" key={title}><span className="flow-index">0{index + 1}</span><div><b>{title}</b><p>{body}</p></div><span className="flow-status">{index === 0 ? 'WRITE' : 'EVENT'}</span></div>)}</div></section>
      <div className="about-side">
        <section className="panel about-section"><span className="eyebrow">PRIVACY, PRECISELY</span><h2>What “private” means here.</h2><ul className="privacy-list"><li><CheckCircle2 size={16} /><span><b>Reporter identity is not shown.</b> Public issue pages omit the authorization-only reporter field.</span></li><li><TriangleAlert size={16} /><span><b>Transactions are public.</b> Wallet addresses and transaction metadata can be inspected on Ethereum and may be linkable elsewhere.</span></li><li><TriangleAlert size={16} /><span><b>Issue details are public.</b> Do not include names, sensitive health details, or private information in reports.</span></li></ul></section>
        <section className="panel about-section"><span className="eyebrow">EVIDENCE COMMITMENTS</span><h2>A hash is not proof.</h2><p>Selecting an image calculates a SHA-256 hash in your browser. The file itself is not uploaded by this interface. Matching a hash later only shows that the bytes match the commitment—it does not authenticate the image, establish when it was created, or prove a real repair.</p><div className="hash-example"><Hash size={15} /><span>SHA-256</span><i>CONTENT COMMITMENT ONLY</i></div></section>
      </div>
    </div>
    <section className="panel demo-checklist"><div><span className="eyebrow">DEMO CHECKLIST</span><h2>Before a live walkthrough.</h2><p>Use a funded wallet on Sepolia and test the role permissions before presenting.</p></div><div className="checklist-items">{['Connect a wallet configured for Sepolia.', 'Confirm administrator and resolver permissions.', 'Submit a report using non-sensitive details.', 'Complete assignment, repair, and resolution actions.', 'Open an event transaction in the Sepolia explorer.'].map((item, index) => <div key={item}><span>0{index + 1}</span>{item}</div>)}</div></section>
  </div>;
}

function Router({ protocol }: { protocol: ReturnType<typeof useProtocol> }) {
  const [path] = useLocation();
  return <RoutedErrorBoundary key={path}><Switch>
    <Route path="/"><HomePage protocol={protocol} /></Route>
    <Route path="/dashboard"><DashboardPage protocol={protocol} /></Route>
    <Route path="/issues"><IssuesPage protocol={protocol} /></Route>
    <Route path="/issues/:id"><IssueDetailPage protocol={protocol} /></Route>
    <Route path="/report"><ReportPage protocol={protocol} /></Route>
    <Route path="/resolver"><ResolverPage protocol={protocol} /></Route>
    <Route path="/authority"><AuthorityPage protocol={protocol} /></Route>
    <Route path="/about"><AboutPage /></Route>
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const protocol = useProtocol();
  return <QueryClientProvider client={queryClient}><TooltipProvider><AppShell protocol={protocol}><Router protocol={protocol} /></AppShell><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
