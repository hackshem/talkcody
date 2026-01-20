// TalkCody Free Login Dialog
// Prompts users to sign in with GitHub or Google, or use their own API Key

import { SiGoogle } from '@icons-pack/react-simple-icons';
import { Github, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUiNavigation } from '@/contexts/ui-navigation';
import type { SupportedLocale } from '@/locales';
import { getLocale } from '@/locales';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { NavigationView } from '@/types/navigation';

interface TalkCodyFreeLoginDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TalkCodyFreeLoginDialog({ open, onClose }: TalkCodyFreeLoginDialogProps) {
  const { setActiveView } = useUiNavigation();
  const language = useSettingsStore((state) => state.language);
  const t = getLocale((language || 'en') as SupportedLocale);
  const { signInWithGitHub, signInWithGoogle } = useAuthStore();

  const handleGitHubSignIn = async () => {
    await signInWithGitHub();
    onClose();
  };

  const handleGoogleSignIn = async () => {
    await signInWithGoogle();
    onClose();
  };

  const handleUseOwnApiKey = () => {
    onClose();
    setActiveView(NavigationView.SETTINGS);
    // Dispatch event to switch to providers tab
    window.dispatchEvent(new CustomEvent('openModelSettingsTab'));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]" showCloseButton={false}>
        <DialogHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg">
              <Sparkles className="size-6 text-white" />
            </div>
            <DialogTitle className="text-xl font-semibold">
              {t.TalkCodyFreeDialog.title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-left text-sm leading-relaxed text-muted-foreground">
            {t.TalkCodyFreeDialog.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <div className="mt-0.5 size-5 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30">
              <span className="flex size-full items-center justify-center text-xs font-medium text-amber-700 dark:text-amber-300">
                1
              </span>
            </div>
            <span>{t.TalkCodyFreeDialog.benefits.preventAbuse}</span>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <div className="mt-0.5 size-5 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30">
              <span className="flex size-full items-center justify-center text-xs font-medium text-amber-700 dark:text-amber-300">
                2
              </span>
            </div>
            <span>{t.TalkCodyFreeDialog.benefits.stableService}</span>
          </div>
        </div>

        <DialogFooter className="w-full gap-3 sm:flex-col">
          <Button
            className="w-full gap-2 bg-[#24292e] hover:bg-[#24292e]/90 dark:bg-[#f6f8fa] dark:text-[#24292e] dark:hover:bg-[#f6f8fa]/90"
            onClick={handleGitHubSignIn}
          >
            <Github className="size-4" />
            {t.TalkCodyFreeDialog.signInWithGitHub}
          </Button>
          <Button variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn}>
            <SiGoogle size={16} />
            {t.TalkCodyFreeDialog.signInWithGoogle}
          </Button>
          <Button variant="outline" className="w-full gap-2" onClick={handleUseOwnApiKey}>
            <Settings className="size-4" />
            {t.TalkCodyFreeDialog.useOwnApiKey}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
