import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Github, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useApp } from '@/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Prefs } from '@shared/types'

const ACCENT_PRESETS = ['#e0555a', '#e08a3c', '#d8c445', '#5fb87a', '#4a9fd8', '#8a6fd8', '#d85fa8']

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 border-t py-3.5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Section({ title, index, children, className }: {
  title: string; index: number; children: React.ReactNode; className?: string
}): JSX.Element {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05, duration: 0.25 }}>
      <Card className={className}>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="pt-3">{children}</CardContent>
      </Card>
    </motion.div>
  )
}

function Segmented<K extends keyof Prefs>({ prefKey, options }: {
  prefKey: K; options: { value: Prefs[K] & string; label: string }[]
}): JSX.Element {
  const value = useApp((s) => s.settings[prefKey]) as string
  const update = useApp((s) => s.updateSetting)
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix emits '' when the active item is clicked again; ignore so a value is always selected.
      onValueChange={(v) => v && void update(prefKey, v as Prefs[K])}
    >
      {options.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function PinDialog({ mode, onClose }: { mode: 'set' | 'disable' | null; onClose: () => void }): JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const setPinEnabled = useApp((s) => s.setPinEnabled)
  const setting = mode === 'set'

  const close = (): void => { setValue(''); onClose() }

  const confirm = async (): Promise<void> => {
    if (busy) return
    if (setting) {
      if (!/^\d{4}$/.test(value)) return void toast.error('PIN must be exactly 4 digits.')
    }
    setBusy(true)
    try {
      const success = setting ? await window.api.pinSet(value) : await window.api.pinDisable(value)
      if (success) {
        setPinEnabled(setting)
        toast.success(setting ? 'PIN lock enabled.' : 'PIN lock disabled.')
        close()
      } else {
        toast.error(setting ? "Couldn't set PIN. Try again." : 'Incorrect PIN.')
        setValue('')
      }
    } catch {
      toast.error(setting ? "Couldn't set PIN. Try again." : "Couldn't verify PIN.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{setting ? 'Set a PIN' : 'Disable PIN lock'}</DialogTitle>
          <DialogDescription>{setting ? 'Choose a 4-digit PIN.' : 'Enter your current PIN to turn the lock off.'}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={4}
          aria-label={setting ? 'New four-digit PIN' : 'Current four-digit PIN'}
          disabled={busy}
          placeholder={setting ? 'Enter 4-digit PIN' : 'Current PIN'}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void confirm()}
        />
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
          <Button disabled={busy} onClick={() => void confirm()}>{busy ? 'Working…' : 'Confirm'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsView(): JSX.Element {
  const s = useApp((st) => st.settings)
  const { updateSetting, pickFolder, refreshLibrary, clearHistory, resetSettings } = useApp()
  const [pinMode, setPinMode] = useState<'set' | 'disable' | null>(null)
  const [delay, setDelay] = useState(s.toolbarHideDelay)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)

  useEffect(() => setDelay(s.toolbarHideDelay), [s.toolbarHideDelay])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Section title="Library" index={0}>
        <Row title="Library Folder" sub={s.libraryFolder ?? 'Not set'}>
          <Button variant="secondary" onClick={() => void pickFolder()}>Change…</Button>
        </Row>
        <Row title="Rescan for new files">
          <Button variant="secondary" onClick={() => void refreshLibrary()}>Rescan Now</Button>
        </Row>
        <Row title="Reading history" sub="Remove all saved progress from Continue Reading.">
          <Button variant="destructive" onClick={() => setConfirmClearHistory(true)}>Clear History</Button>
        </Row>
      </Section>

      <Section title="Appearance" index={1}>
        <Row title="Theme">
          <Segmented prefKey="theme" options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </Row>
        <Row title="Accent Color">
          <div className="flex items-center gap-2">
            {ACCENT_PRESETS.map((c) => (
              <motion.button
                key={c}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                title={c}
                onClick={() => void updateSetting('accentColor', c)}
                style={{ background: c }}
                className={cn(
                  'h-6 w-6 rounded-full ring-offset-2 ring-offset-card transition-shadow',
                  c.toLowerCase() === s.accentColor.toLowerCase() && 'ring-2 ring-foreground'
                )}
              />
            ))}
            <input
              type="color"
              title="Custom color"
              value={s.accentColor}
              onChange={(e) => void updateSetting('accentColor', e.target.value)}
              className="h-6 w-8 cursor-pointer rounded border bg-transparent"
            />
          </div>
        </Row>
        <Row title="Cover Size">
          <Segmented prefKey="cardSize" options={[
            { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }
          ]} />
        </Row>
        <Row title="Animations" sub="Hover motion and view transitions.">
          <Switch checked={s.animationsEnabled} onCheckedChange={(v) => void updateSetting('animationsEnabled', v)} />
        </Row>
      </Section>

      <Section title="Reading" index={2}>
        <Row title="Reading Direction" sub="Right-to-left matches traditional manga page order.">
          <Segmented prefKey="readingDirection" options={[
            { value: 'ltr', label: 'Left → Right' }, { value: 'rtl', label: 'Right → Left' }
          ]} />
        </Row>
        <Row title="Default Page Fit">
          <Segmented prefKey="defaultFit" options={[
            { value: 'contain', label: 'Page' }, { value: 'width', label: 'Width' },
            { value: 'height', label: 'Height' }, { value: 'original', label: 'Original' }
          ]} />
        </Row>
        <Row title="Auto-hide Toolbar" sub="Hide reader controls after a few seconds of inactivity.">
          <Switch checked={s.toolbarAutoHide} onCheckedChange={(v) => void updateSetting('toolbarAutoHide', v)} />
        </Row>
        <Row title="Auto-hide Delay">
          <div className={cn('flex w-56 items-center gap-3', !s.toolbarAutoHide && 'opacity-40')}>
            <Slider
              min={1000} max={6000} step={500}
              value={[delay]}
              disabled={!s.toolbarAutoHide}
              onValueChange={([v]) => setDelay(v)}
              onValueCommit={([v]) => void updateSetting('toolbarHideDelay', v)}
            />
            <span className="w-9 text-right text-xs text-muted-foreground">{(delay / 1000).toFixed(1)}s</span>
          </div>
        </Row>
      </Section>

      <Section title="Security" index={3}>
        <Row title="PIN Lock" sub="Requires a PIN when opening the app. Files on disk are not encrypted.">
          <Switch checked={s.pinEnabled} onCheckedChange={(v) => setPinMode(v ? 'set' : 'disable')} />
        </Row>
      </Section>

      <Section title="Advanced" index={4}>
        <Row title="Reset appearance & reading settings" sub="Restores defaults. Does not affect your library, history, or PIN.">
          <Button variant="destructive" onClick={() => setConfirmReset(true)}>Reset to Defaults</Button>
        </Row>
      </Section>

      <Section title="Credits" index={5}>
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Built by Izumi</div>
            <div className="text-xs text-muted-foreground">Manga Library — designed &amp; developed by Izumi.</div>
          </div>
          <Button onClick={() => void window.api.openExternal('https://github.com/izumicancode')}>
            <Github /> github.com/izumicancode
          </Button>
        </div>
      </Section>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Manga Library v3.0.0 — by Izumicancode
      </p>

      <PinDialog mode={pinMode} onClose={() => setPinMode(null)} />
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset settings?</DialogTitle>
            <DialogDescription>Appearance and reading settings return to their defaults.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setConfirmReset(false); void resetSettings() }}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmClearHistory} onOpenChange={setConfirmClearHistory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear reading history?</DialogTitle>
            <DialogDescription>All saved reading progress and bookmarks will be removed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmClearHistory(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              setConfirmClearHistory(false)
              void clearHistory().then((cleared) => { if (cleared) toast.success('History cleared.') })
            }}>Clear History</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
