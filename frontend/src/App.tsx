import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp,
  Clock3, CloudUpload, Command, Database, Download, FileChartColumn, Gauge, LayoutDashboard,
  LoaderCircle, Menu, MoreHorizontal, Search, ShieldCheck, SlidersHorizontal, Sparkles, Upload,
  X, Zap, CheckCircle2, CircleAlert, RefreshCw, Cpu, GitCompareArrows,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, type Alert, type Dashboard, type MonitoringRun } from './lib/api'

type Page = 'Overview' | 'Models' | 'Monitoring runs' | 'Alerts'
const NAV = [
  { label: 'Overview' as Page, icon: LayoutDashboard },
  { label: 'Models' as Page, icon: Cpu },
  { label: 'Monitoring runs' as Page, icon: Activity },
  { label: 'Alerts' as Page, icon: Bell },
]
const fmtDate = (value?: string) => value ? new Date(value).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '—'
const fmtPct = (value?: number | null) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const shortDate = (value?: string) => value ? new Date(value).toLocaleDateString([], {month: 'short', day: 'numeric'}) : ''

function StatusPill({status}: {status: string}) {
  const normalized = status.toLowerCase()
  const cls = normalized === 'healthy' || normalized === 'active' || normalized === 'resolved' ? 'good' : normalized === 'critical' || normalized === 'high' ? 'critical' : normalized === 'warning' || normalized === 'medium' ? 'warning' : 'neutral'
  return <span className={`status-pill ${cls}`}><span className="status-dot" />{status}</span>
}
function SectionTitle({eyebrow, title, description, action}: {eyebrow?: string; title: string; description?: string; action?: React.ReactNode}) {
  return <div className="section-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="title-action">{action}</div>}</div>
}
function MetricCard({label, value, detail, icon: Icon, tone = 'blue', trend}: {label: string; value: string; detail: string; icon: React.ElementType; tone?: string; trend?: 'up' | 'down'}) {
  return <div className="metric-card"><div className="metric-top"><span className={`metric-icon ${tone}`}><Icon size={18}/></span>{trend && <span className={`trend ${trend}`}>{trend === 'up' ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>} live</span>}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>
}
function EmptyState({title, text}: {title: string; text: string}) { return <div className="empty-state"><div className="empty-icon"><FileChartColumn size={22}/></div><strong>{title}</strong><p>{text}</p></div> }

export default function App() {
  const [page, setPage] = useState<Page>('Overview')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [runs, setRuns] = useState<MonitoringRun[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [models, setModels] = useState<Array<{id:number;name:string;version:string;model_type:string;status:string}>>([])
  const [selectedRun, setSelectedRun] = useState<(MonitoringRun & {results?: NonNullable<MonitoringRun['results']>}) | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [d, r, a, m] = await Promise.all([api.dashboard(), api.runs(), api.alerts(), api.models()])
      setDashboard(d); setRuns(r); setAlerts(a); setModels(m); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect to API') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const openRun = async (id: number) => {
    try { setSelectedRun(await api.run(id)) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load run') }
  }
  const handleFile = async (file?: File) => {
    if (!file) return
    setUploading(true); setError(''); setNotice('')
    try {
      const result = await api.monitor(file)
      setNotice(`Monitoring run #${result.run_id} completed — ${result.drifted_features} feature(s) drifted.`)
      setUploadOpen(false); await refresh(); await openRun(result.run_id!)
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const loadDemo = async (kind: 'stable' | 'shifted') => {
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/demo-csv/${kind}`)
      if (!response.ok) throw new Error('Demo CSV files are not available. Generate them using the backend setup instructions.')
      const file = new File([await response.blob()], `${kind === 'stable' ? 'production_stable' : 'production_shifted'}.csv`, {type:'text/csv'})
      await handleFile(file)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load demo data') }
  }
  const acknowledge = async (alert: Alert) => {
    try { await api.acknowledge(alert.id, !Boolean(alert.acknowledged)); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update alert') }
  }
  const filteredRuns = useMemo(() => runs.filter(r => `${r.id} ${r.status} ${r.created_at}`.toLowerCase().includes(query.toLowerCase())), [runs, query])
  const filteredAlerts = useMemo(() => alerts.filter(a => `${a.feature} ${a.severity} ${a.message}`.toLowerCase().includes(query.toLowerCase())), [alerts, query])

  const renderOverview = () => {
    const history = [...(dashboard?.recent_runs || [])].reverse().map((run, i) => ({name: shortDate(run.created_at) || `Run ${i+1}`, drift: Math.round((run.drift_share || 0) * 100), f1: run.f1 == null ? null : Math.round(run.f1 * 100), accuracy: run.accuracy == null ? null : Math.round(run.accuracy * 100)}))
    const latest = dashboard?.latest_run
    return <>
      <SectionTitle eyebrow="MONITORING CENTER" title="Model overview" description="Monitor model health, detect drift, and keep your ML systems reliable." action={<button className="btn btn-primary" onClick={() => setUploadOpen(true)}><CloudUpload size={16}/> Run monitoring</button>}/>
      <div className="welcome-banner"><div className="welcome-orb"><Sparkles size={22}/></div><div className="welcome-copy"><div className="welcome-tag"><span className="pulse-dot"/> MODEL STATUS <span className="welcome-divider"/> <span className="welcome-active">{dashboard?.model.status || 'Active'}</span></div><h2>Your model health at a glance.</h2><p>Run a check against fresh data to catch distribution shifts before they become production problems.</p></div><div className="banner-art"><div className="art-ring ring-one"/><div className="art-ring ring-two"/><div className="art-center"><Activity size={27}/></div><span className="art-point point-one"/><span className="art-point point-two"/><span className="art-point point-three"/></div></div>
      <div className="metric-grid">
        <MetricCard label="Monitoring runs" value={String(dashboard?.total_runs ?? 0)} detail="Total completed checks" icon={Activity} tone="blue"/>
        <MetricCard label="Drifted features" value={latest ? `${latest.drifted_features}/5` : '—'} detail="Latest monitoring run" icon={GitCompareArrows} tone="violet"/>
        <MetricCard label="Model accuracy" value={fmtPct(latest?.accuracy)} detail={latest?.accuracy == null ? 'Ground-truth labels required' : 'Latest labeled batch'} icon={Gauge} tone="green"/>
        <MetricCard label="Open alerts" value={String(dashboard?.open_alerts ?? 0)} detail="Need your attention" icon={AlertTriangle} tone="orange"/>
      </div>
      <div className="content-grid overview-grid">
        <div className="panel chart-panel"><div className="panel-heading"><div><h3>Monitoring trends</h3><p>Drift share and model F1 across recent runs</p></div><span className="chart-legend"><i className="legend-blue"/> Drift <i className="legend-green"/> F1 score</span></div>{history.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{top:10,right:8,left:-22,bottom:0}}><defs><linearGradient id="driftFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c6cff" stopOpacity={0.25}/><stop offset="95%" stopColor="#7c6cff" stopOpacity={0}/></linearGradient><linearGradient id="f1Fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#31d7a4" stopOpacity={0.16}/><stop offset="95%" stopColor="#31d7a4" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#252d43" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="name" tick={{fill:'#818ba5',fontSize:11}} axisLine={false} tickLine={false}/><YAxis domain={[0,100]} tick={{fill:'#818ba5',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`}/><Tooltip contentStyle={{background:'#121a2d',border:'1px solid #29344d',borderRadius:10,color:'#eef2ff'}} formatter={(v:any,n:any)=>[`${v}%`,n==='drift'?'Drift share':'F1 score']}/><Area type="monotone" dataKey="drift" stroke="#8c7bff" strokeWidth={2.5} fill="url(#driftFill)"/>{history.some(h=>h.f1!==null) && <Area type="monotone" dataKey="f1" connectNulls stroke="#31d7a4" strokeWidth={2.5} fill="url(#f1Fill)"/>}</AreaChart></ResponsiveContainer></div> : <EmptyState title="No monitoring history yet" text="Run your first check to populate trends and model health metrics."/>}<div className="chart-footer"><span><span className="tiny-live"/> Live from stored monitoring runs</span><button className="text-btn" onClick={()=>setPage('Monitoring runs')}>View history <ArrowUpRight size={14}/></button></div></div>
        <div className="panel model-panel"><div className="panel-heading"><div><h3>Registered model</h3><p>Active model registry</p></div><button className="icon-btn" title="Model details" onClick={()=>setPage('Models')}><MoreHorizontal size={18}/></button></div><div className="model-hero"><div className="model-emblem"><Cpu size={24}/></div><div><h4>{dashboard?.model.name || 'Customer Churn Classifier'}</h4><span className="model-version">{dashboard?.model.version || 'v1.0.0'} <span className="version-dot"/> {dashboard?.model.type || 'Random Forest'}</span></div></div><div className="model-stats"><div><span>Model type</span><strong>Classification</strong></div><div><span>Input features</span><strong>5 features</strong></div><div><span>Monitor status</span><StatusPill status={latest?.status || 'Healthy'}/></div></div><button className="btn btn-secondary full-btn" onClick={()=>setPage('Models')}>View model details <ArrowUpRight size={15}/></button></div>
      </div>
      <div className="panel table-panel"><div className="panel-heading"><div><h3>Recent monitoring runs</h3><p>Latest checks across your registered model</p></div><button className="text-btn" onClick={()=>setPage('Monitoring runs')}>View all <ArrowUpRight size={14}/></button></div><RunsTable runs={(dashboard?.recent_runs || []).slice(0,5)} onOpen={(r)=>r.id && void openRun(r.id)}/></div>
      <div className="quick-actions"><button className="quick-card" onClick={()=>setUploadOpen(true)}><span className="quick-icon purple"><Upload size={18}/></span><span><strong>Monitor new data</strong><small>Upload a production CSV batch</small></span><ArrowUpRight size={16}/></button><button className="quick-card" onClick={()=>void loadDemo('shifted')}><span className="quick-icon orange"><Zap size={18}/></span><span><strong>Try drift demo</strong><small>Run a sample shifted dataset</small></span><ArrowUpRight size={16}/></button><button className="quick-card" onClick={()=>setPage('Alerts')}><span className="quick-icon green"><ShieldCheck size={18}/></span><span><strong>Review alerts</strong><small>{dashboard?.open_alerts ?? 0} open alert(s)</small></span><ArrowUpRight size={16}/></button></div>
    </>
  }

  const renderModels = () => <><SectionTitle eyebrow="REGISTRY" title="Model registry" description="Manage registered models and inspect their monitoring configuration." action={<span className="tag tag-green"><span className="status-dot"/> {models.length} registered</span>}/><div className="model-cards">{models.map(model=><div className="panel registry-card" key={model.id}><div className="registry-card-top"><div className="model-emblem"><Cpu size={22}/></div><StatusPill status={model.status}/></div><h3>{model.name}</h3><p className="muted">{model.model_type} · Version {model.version}</p><div className="registry-meta"><div><span>Model ID</span><strong>MDL-{String(model.id).padStart(4,'0')}</strong></div><div><span>Features monitored</span><strong>5</strong></div><div><span>Target</span><strong>churn</strong></div></div><div className="registry-footer"><span><Database size={14}/> Local artifact registry</span><span className="tag">Baseline v1</span></div></div>)}</div><div className="panel info-panel"><div className="info-icon"><CircleHelp size={19}/></div><div><h3>How this registry works</h3><p>The MVP registers the demo Random Forest model automatically. Its fitted artifact and reference dataset are stored locally. Model upload/versioning workflows can be added after the monitoring pipeline is stable.</p></div></div></>

  const renderRuns = () => <><SectionTitle eyebrow="OBSERVABILITY" title="Monitoring runs" description="Explore batch checks, drift scores, and performance metrics." action={<button className="btn btn-primary" onClick={()=>setUploadOpen(true)}><CloudUpload size={16}/> New run</button>}/><div className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search runs..."/></div><span className="muted small-text">{filteredRuns.length} runs</span></div><RunsTable runs={filteredRuns} onOpen={(r)=>r.id && void openRun(r.id)} detailed/></div></>

  const renderAlerts = () => <><SectionTitle eyebrow="INCIDENTS" title="Alerts & anomalies" description="Investigate feature drift and track acknowledgement status." action={<span className="tag tag-orange"><AlertTriangle size={13}/> {alerts.filter(a=>!a.acknowledged).length} open</span>}/><div className="alert-summary-grid"><div className="panel alert-summary"><span className="quick-icon orange"><CircleAlert size={18}/></span><div><span>Open alerts</span><strong>{alerts.filter(a=>!a.acknowledged).length}</strong></div></div><div className="panel alert-summary"><span className="quick-icon green"><CheckCircle2 size={18}/></span><div><span>Acknowledged</span><strong>{alerts.filter(a=>a.acknowledged).length}</strong></div></div><div className="panel alert-summary"><span className="quick-icon purple"><GitCompareArrows size={18}/></span><div><span>Features affected</span><strong>{new Set(alerts.filter(a=>!a.acknowledged).map(a=>a.feature)).size}</strong></div></div></div><div className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search alerts..."/></div><span className="muted small-text">Newest first</span></div>{filteredAlerts.length ? <div className="alert-list">{filteredAlerts.map(alert=><div className={`alert-row ${alert.acknowledged?'acknowledged':''}`} key={alert.id}><div className={`alert-symbol ${alert.severity.toLowerCase()}`}><AlertTriangle size={17}/></div><div className="alert-main"><div className="alert-title-line"><strong>{alert.feature.replaceAll('_',' ')}</strong><StatusPill status={alert.severity}/></div><p>{alert.message}</p><span className="alert-meta">Run #{alert.run_id} · {fmtDate(alert.created_at)}</span></div><button className={`btn ${alert.acknowledged?'btn-secondary':'btn-ack'}`} onClick={()=>void acknowledge(alert)}>{alert.acknowledged?<><Check size={14}/> Acknowledged</>:<><Check size={14}/> Acknowledge</>}</button></div>)}</div> : <EmptyState title="No alerts found" text="Run monitoring on a shifted dataset to generate feature drift alerts."/>}</div></>

  return <div className="app-shell">
    {sidebarOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={()=>setSidebarOpen(false)}/>}
    <aside className={`sidebar ${sidebarOpen?'open':''}`}><div className="brand"><div className="brand-mark"><Activity size={21} strokeWidth={2.5}/></div><div className="brand-name">model<span>ops</span><small>ML OBSERVABILITY</small></div><button className="mobile-close icon-btn" onClick={()=>setSidebarOpen(false)}><X size={18}/></button></div><div className="workspace-label">WORKSPACE</div><button className="workspace-switch"><div className="workspace-avatar">AC</div><div className="workspace-copy"><strong>Acme ML Lab</strong><span>Free workspace</span></div><ChevronDown size={15}/></button><div className="nav-label">PLATFORM</div><nav className="main-nav">{NAV.map(item=>{const Icon=item.icon;return <button key={item.label} className={`nav-item ${page===item.label?'active':''}`} onClick={()=>{setPage(item.label);setSidebarOpen(false);setQuery('')}}><Icon size={18}/><span>{item.label}</span>{item.label==='Alerts' && (dashboard?.open_alerts ?? 0)>0 && <span className="nav-count">{dashboard?.open_alerts}</span>}</button>})}</nav><div className="sidebar-bottom"><div className="usage-card"><div className="usage-top"><span>MONITORING USAGE</span><span>FREE</span></div><div className="usage-bar"><span style={{width:`${Math.min((dashboard?.total_runs ?? 0)*10,100)}%`}}/></div><p>{dashboard?.total_runs ?? 0} of 10 demo runs used</p><button onClick={()=>setNotice('You are using the local ModelOps demo workspace.')}>Workspace details <ArrowUpRight size={13}/></button></div><div className="user-profile"><div className="user-avatar">JD</div><div className="user-copy"><strong>Jordan Davis</strong><span>ML Engineer</span></div><MoreHorizontal size={18} className="profile-more"/></div></div></aside>
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-btn" onClick={()=>setSidebarOpen(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{page}</strong></div><span className="environment-tag"><span className="status-dot"/> DEV ENV</span></div><div className="topbar-right"><div className="global-search"><Search size={15}/><input placeholder="Search anything..." value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd></div><button className="icon-btn topbar-bell" title="View alerts" onClick={()=>setPage('Alerts')}><Bell size={18}/>{(dashboard?.open_alerts ?? 0)>0 && <i/>}</button><div className="topbar-avatar">JD</div></div></header>
      <div className="page-content">{error && <div className="notice error-notice"><AlertTriangle size={17}/><span>{error}{error.includes('fetch') || error.includes('Failed to fetch') ? ' — make sure the FastAPI backend is running on port 8000.' : ''}</span><button onClick={()=>setError('')}><X size={15}/></button></div>}{notice && <div className="notice success-notice"><CheckCircle2 size={17}/><span>{notice}</span><button onClick={()=>setNotice('')}><X size={15}/></button></div>}{loading ? <div className="loading-screen"><LoaderCircle className="spin" size={28}/><p>Connecting to monitoring service...</p></div> : <>{page==='Overview' && renderOverview()}{page==='Models' && renderModels()}{page==='Monitoring runs' && renderRuns()}{page==='Alerts' && renderAlerts()}</>}</div>
      <footer className="app-footer"><span>© 2026 ModelOps <span className="footer-dot">·</span> ML observability, simplified.</span><span><span className="footer-health"/> All systems operational <span className="footer-dot">·</span> <button onClick={()=>window.open('http://127.0.0.1:8000/docs','_blank')}>API docs <ArrowUpRight size={12}/></button></span></footer>
    </main>
    {uploadOpen && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setUploadOpen(false)}}><div className="modal"><div className="modal-heading"><div><div className="eyebrow">NEW MONITORING RUN</div><h2>Monitor a data batch</h2><p>Compare incoming data with the registered model's reference distribution.</p></div><button className="icon-btn" onClick={()=>setUploadOpen(false)}><X size={19}/></button></div><button className="dropzone" onClick={()=>fileRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void handleFile(e.dataTransfer.files[0])}}><div className="drop-icon"><CloudUpload size={24}/></div><strong>Drop your CSV file here</strong><span>or click to browse from your computer</span><small>CSV · Max 15 MB</small></button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e=>void handleFile(e.target.files?.[0])}/>{uploading && <div className="upload-progress"><LoaderCircle className="spin" size={17}/> Running drift tests and model inference...</div>}<div className="modal-divider"><span>OR TRY A SAMPLE DATASET</span></div><div className="demo-options"><button onClick={()=>void loadDemo('stable')} disabled={uploading}><span className="demo-dot stable"/><span><strong>Stable batch</strong><small>Expected to show low drift</small></span><ArrowUpRight size={15}/></button><button onClick={()=>void loadDemo('shifted')} disabled={uploading}><span className="demo-dot shifted"/><span><strong>Shifted batch</strong><small>Simulated production drift</small></span><ArrowUpRight size={15}/></button></div><div className="modal-note"><CircleHelp size={15}/><span>CSV must contain five feature columns. Include a <code>churn</code> column (0/1) to evaluate model metrics.</span></div></div></div>}
    {selectedRun && <RunDetail run={selectedRun} onClose={()=>setSelectedRun(null)}/>}
  </div>
}

function RunsTable({runs, onOpen, detailed=false}: {runs: MonitoringRun[]; onOpen:(run:MonitoringRun)=>void; detailed?:boolean}) {
  if (!runs.length) return <EmptyState title="No monitoring runs yet" text="Upload a production batch or try the sample drift demo to get started."/>
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>RUN ID</th><th>STATUS</th><th>DATASET ROWS</th><th>DRIFTED FEATURES</th><th>{detailed?'ACCURACY':'DRIFT SHARE'}</th><th>CREATED</th><th/></tr></thead><tbody>{runs.map((run,i)=><tr key={run.id ?? `${run.created_at}-${i}`} onClick={()=>onOpen(run)} className="clickable-row"><td><span className="run-id">#{String(run.id ?? run.run_id ?? '—').padStart(4,'0')}</span></td><td><StatusPill status={run.status}/></td><td>{(run.rows_scanned ?? 0).toLocaleString()}</td><td><span className="drift-count"><span className={`mini-bar ${run.drifted_features?'is-drifted':''}`} style={{width:`${Math.max(5,run.drifted_features/5*100)}%`}}/>{run.drifted_features}/5</span></td><td>{detailed?fmtPct(run.accuracy):`${Math.round((run.drift_share ?? 0)*100)}%`}</td><td className="muted">{fmtDate(run.created_at)}</td><td><button className="icon-btn table-more" onClick={e=>{e.stopPropagation();onOpen(run)}} title="View run"><ArrowUpRight size={15}/></button></td></tr>)}</tbody></table></div>
}

function RunDetail({run, onClose}: {run: MonitoringRun & {results?: NonNullable<MonitoringRun['results']>}; onClose:()=>void}) {
  const features = run.results?.features ?? []
  return <div className="modal-backdrop detail-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="detail-modal"><div className="modal-heading"><div><div className="eyebrow">MONITORING RUN #{String(run.id ?? run.run_id).padStart(4,'0')}</div><h2>Run details</h2><p>{fmtDate(run.created_at)} · {run.rows_scanned} rows scanned</p></div><div className="detail-heading-right"><StatusPill status={run.status}/><button className="icon-btn" onClick={onClose}><X size={19}/></button></div></div><div className="detail-kpis"><div><span>Drifted features</span><strong>{run.drifted_features}/5</strong></div><div><span>Drift share</span><strong>{Math.round((run.drift_share??0)*100)}%</strong></div><div><span>Accuracy</span><strong>{fmtPct(run.accuracy)}</strong></div><div><span>F1 score</span><strong>{fmtPct(run.f1)}</strong></div></div><div className="detail-section-title"><h3>Feature drift analysis</h3><span>KS test + Population Stability Index</span></div>{features.length ? <div className="table-scroll"><table className="data-table feature-table"><thead><tr><th>FEATURE</th><th>STATUS</th><th>PSI</th><th>P-VALUE</th><th>REFERENCE MEAN</th><th>CURRENT MEAN</th></tr></thead><tbody>{features.map(f=><tr key={f.feature}><td className="feature-name">{f.feature.replaceAll('_',' ')}</td><td><StatusPill status={f.drifted?'Warning':'Healthy'}/></td><td>{f.psi.toFixed(3)}</td><td>{f.p_value.toFixed(4)}</td><td>{f.reference_mean.toFixed(2)}</td><td>{f.current_mean.toFixed(2)}</td></tr>)}</tbody></table></div>:<EmptyState title="Feature results unavailable" text="This monitoring run does not include feature-level results."/>}<div className="detail-section-title prediction-title"><h3>Prediction distribution</h3><span>Model outputs on this batch</span></div><div className="prediction-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={run.results?.prediction_distribution ?? []} margin={{top:8,right:12,left:0,bottom:0}}><CartesianGrid stroke="#252d43" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{fill:'#a1abc3',fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#818ba5',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#121a2d',border:'1px solid #29344d',borderRadius:10,color:'#eef2ff'}}/><Bar dataKey="count" name="Predictions" radius={[5,5,0,0]}>{(run.results?.prediction_distribution ?? []).map((entry,i)=><Cell key={entry.label} fill={i===0?'#7c6cff':'#31d7a4'}/>)}</Bar></BarChart></ResponsiveContainer></div><div className="metrics-note"><CircleHelp size={15}/><span>{run.results?.metrics_note ?? 'Performance metrics require labeled evaluation data.'}</span></div></div></div>
}
