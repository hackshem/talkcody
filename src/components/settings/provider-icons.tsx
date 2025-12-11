import {
  SiAnthropic,
  SiElevenlabs,
  SiGooglegemini,
  SiOllama,
  SiOpenai,
  SiVercel,
} from '@icons-pack/react-simple-icons';
import type { ComponentType } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

// Image-based icon component for providers without simple-icons
function createImageIcon(src: string, alt: string) {
  return function ImageIcon({ size = 16, className }: IconProps) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        className={className}
        alt={alt}
        style={{ objectFit: 'contain' }}
      />
    );
  };
}

// Icon mapping for all providers
export const PROVIDER_ICONS: Record<string, ComponentType<IconProps>> = {
  // Providers with simple-icons
  aiGateway: SiVercel,
  openai: SiOpenai,
  anthropic: SiAnthropic,
  google: SiGooglegemini,
  ollama: SiOllama,
  elevenlabs: SiElevenlabs,

  // Providers with local SVG icons
  deepseek: createImageIcon('/icons/providers/deepseek.svg', 'DeepSeek'),
  moonshot: createImageIcon('/icons/providers/kimi.svg', 'Kimi'),
  lmstudio: createImageIcon('/icons/providers/lmstudio.svg', 'LM Studio'),
  MiniMax: createImageIcon('/icons/providers/minimax.svg', 'Minimax'),
  openRouter: createImageIcon('/icons/providers/openrouter.svg', 'OpenRouter'),
  tavily: createImageIcon('/icons/providers/tavily.svg', 'Tavily'),

  // Providers with downloaded favicon images
  zhipu: createImageIcon('/icons/providers/zhipu.png', 'Zhipu AI'),
};

// Provider icon component
export function ProviderIcon({
  providerId,
  size = 16,
  className,
}: IconProps & { providerId: string }) {
  const Icon = PROVIDER_ICONS[providerId];
  if (!Icon) return null;
  return <Icon size={size} className={className} />;
}
