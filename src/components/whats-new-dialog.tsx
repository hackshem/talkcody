import { getVersion } from '@tauri-apps/api/app';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { ExternalLink, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import {
  type ChangelogContent,
  type ChangelogEntry,
  getChangelogForVersion,
  getLatestChangelog,
} from '@/services/changelog-service';
import { useSettingsStore } from '@/stores/settings-store';

interface WhatsNewDialogProps {
  // Optional: force open (for "View Release Notes" button in settings)
  forceOpen?: boolean;
  onForceOpenChange?: (open: boolean) => void;
}

export function WhatsNewDialog({ forceOpen, onForceOpenChange }: WhatsNewDialogProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [changelog, setChangelog] = useState<ChangelogEntry | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('');

  const lastSeenVersion = useSettingsStore((state) => state.last_seen_version);
  const setLastSeenVersion = useSettingsStore((state) => state.setLastSeenVersion);
  const isInitialized = useSettingsStore((state) => state.isInitialized);

  // Check if we need to show the dialog
  useEffect(() => {
    if (!isInitialized) return;

    const checkVersion = async () => {
      try {
        const version = await getVersion();
        setCurrentVersion(version);

        // Try to get changelog for current version, fallback to latest
        const entry = getChangelogForVersion(version) ?? getLatestChangelog();
        setChangelog(entry ?? null);

        // TODO: Remove this line after testing - forces dialog to show
        // setOpen(true); // Uncomment for testing

        // If current version differs from last seen version, show dialog
        if (lastSeenVersion !== version && entry) {
          logger.info(
            `Showing What's New dialog for version ${version} (last seen: ${lastSeenVersion})`
          );
          setOpen(true);
        }
      } catch (error) {
        logger.error("Failed to check version for What's New:", error);
      }
    };

    checkVersion();
  }, [isInitialized, lastSeenVersion]);

  // Handle force open (from settings page)
  useEffect(() => {
    if (forceOpen) {
      // When force opening, ensure we have changelog data
      if (!changelog) {
        const entry = getLatestChangelog();
        setChangelog(entry ?? null);
      }
      setOpen(true);
    } else if (forceOpen === false) {
      setOpen(false);
    }
  }, [forceOpen, changelog]);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onForceOpenChange?.(newOpen);

    // When closing, record that user has seen current version
    if (!newOpen && currentVersion) {
      setLastSeenVersion(currentVersion);
    }
  };

  const handleDismiss = () => {
    handleOpenChange(false);
  };

  const handleViewFullChangelog = async () => {
    // Open docs website changelog page using Tauri shell
    await shellOpen('https://talkcody.com/docs/changelog');
  };

  if (!changelog) {
    return null;
  }

  // Get content based on current locale, fallback to English
  const content: ChangelogContent = changelog[locale as 'en' | 'zh'] || changelog.en;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-yellow-500" />
            {t.WhatsNew.title}
            <Badge variant="secondary" className="ml-2">
              v{changelog.version}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {changelog.date && t.WhatsNew.releasedOn(changelog.date)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Added */}
          {content.added && content.added.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-green-600 dark:text-green-400">
                {t.WhatsNew.added}
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {content.added.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Changed */}
          {content.changed && content.changed.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                {t.WhatsNew.changed}
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {content.changed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Fixed */}
          {content.fixed && content.fixed.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                {t.WhatsNew.fixed}
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {content.fixed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Removed */}
          {content.removed && content.removed.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">
                {t.WhatsNew.removed}
              </h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {content.removed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleViewFullChangelog}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t.WhatsNew.viewFullChangelog}
          </Button>
          <Button onClick={handleDismiss}>{t.WhatsNew.gotIt}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
