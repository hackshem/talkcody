// Publish agent to marketplace dialog

import { Github, Plus, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { logger } from '@/lib/logger';
import { apiClient } from '@/services/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { Agent } from '@/types';

interface PublishAgentDialogProps {
  agent: Agent;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormData {
  name: string;
  description: string;
  longDescription: string;
  categories: string[];
  tags: string[];
  iconUrl: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string;
}

export function PublishAgentDialog({ agent, open, onClose, onSuccess }: PublishAgentDialogProps) {
  const { isAuthenticated, user, signInWithGitHub } = useAuthStore();

  // Generate unique IDs for form elements
  const nameId = useId();
  const descriptionId = useId();
  const longDescriptionId = useId();
  const iconUrlId = useId();

  const [formData, setFormData] = useState<FormData>({
    name: agent.name,
    description: agent.description,
    longDescription: '',
    categories: [],
    tags: [],
    iconUrl: '',
  });
  const [newTag, setNewTag] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);

  // Fetch categories from API
  useEffect(() => {
    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      try {
        const response = await apiClient.get('/api/marketplace/categories');
        if (response.ok) {
          const data = await response.json();
          setCategories(data.categories || []);
        } else {
          toast.error('Failed to load categories');
        }
      } catch (error) {
        logger.error('Failed to fetch categories:', error);
        toast.error('Failed to load categories');
      } finally {
        setIsLoadingCategories(false);
      }
    };

    if (open) {
      fetchCategories();
    }
  }, [open]);

  const handleInputChange = (field: keyof FormData, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddCategory = (categoryId: string) => {
    if (!formData.categories.includes(categoryId)) {
      handleInputChange('categories', [...formData.categories, categoryId]);
    }
  };

  const handleRemoveCategory = (categoryId: string) => {
    handleInputChange(
      'categories',
      formData.categories.filter((id) => id !== categoryId)
    );
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      handleInputChange('tags', [...formData.tags, newTag.trim()]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    handleInputChange(
      'tags',
      formData.tags.filter((t) => t !== tag)
    );
  };

  const handlePublish = async () => {
    // Validation
    if (!formData.name.trim()) {
      toast.error('Agent name is required');
      return;
    }

    if (!formData.description.trim()) {
      toast.error('Description is required');
      return;
    }

    if (formData.categories.length === 0) {
      toast.error('Please select at least one category');
      return;
    }

    if (!isAuthenticated) {
      toast.error('Please sign in to publish agents');
      return;
    }

    setIsPublishing(true);

    try {
      const response = await apiClient.post(
        '/api/agents',
        {
          name: formData.name,
          description: formData.description,
          longDescription: formData.longDescription || formData.description,
          modelType: agent.model_type,
          systemPrompt: agent.system_prompt,
          toolsConfig: JSON.parse(agent.tools_config || '{}'),
          rules: agent.rules || undefined,
          outputFormat: agent.output_format || undefined,
          dynamicPromptConfig: agent.dynamic_enabled
            ? {
                enabled: agent.dynamic_enabled,
                providers: JSON.parse(agent.dynamic_providers || '[]'),
                variables: JSON.parse(agent.dynamic_variables || '{}'),
              }
            : undefined,
          iconUrl: formData.iconUrl || undefined,
          categoryIds: formData.categories,
          tags: formData.tags,
        },
        { requireAuth: true }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to publish agent');
      }

      const data = await response.json();

      // Auto-publish the agent
      const publishResponse = await apiClient.post(
        `/api/agents/${data.agent.id}/publish`,
        undefined,
        { requireAuth: true }
      );

      if (!publishResponse.ok) {
        throw new Error('Failed to publish agent');
      }

      toast.success('Agent published successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      logger.error('Publish error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to publish agent');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publish Agent to Marketplace</DialogTitle>
          <DialogDescription>Share your agent with the TalkCody community</DialogDescription>
        </DialogHeader>

        {/* Sign In Section - shown when not authenticated */}
        {!isAuthenticated && (
          <div className="space-y-4 py-4 border-b">
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              <p className="text-sm text-muted-foreground">
                You need to sign in to publish agents to the marketplace
              </p>
              <Button onClick={signInWithGitHub} variant="default" className="w-full">
                <Github className="mr-2 h-4 w-4" />
                Sign in with GitHub
              </Button>
            </div>
          </div>
        )}

        {/* User Info - shown when authenticated */}
        {isAuthenticated && user && (
          <div className="py-2 border-b">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Publishing as</span>
              <span className="font-medium text-foreground">{user.displayName || user.name}</span>
            </div>
          </div>
        )}

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor={nameId}>Agent Name *</Label>
            <Input
              id={nameId}
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="My Awesome Agent"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor={descriptionId}>Short Description *</Label>
            <Textarea
              id={descriptionId}
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="A brief description of what your agent does"
              rows={2}
            />
          </div>

          {/* Long Description */}
          <div className="space-y-2">
            <Label htmlFor={longDescriptionId}>Detailed Description</Label>
            <Textarea
              id={longDescriptionId}
              value={formData.longDescription}
              onChange={(e) => handleInputChange('longDescription', e.target.value)}
              placeholder="Provide more details about your agent's capabilities, use cases, and features"
              rows={4}
            />
          </div>

          {/* Categories */}
          <div className="space-y-2">
            <Label>Categories *</Label>
            <Select onValueChange={handleAddCategory} disabled={isLoadingCategories}>
              <SelectTrigger>
                <SelectValue
                  placeholder={isLoadingCategories ? 'Loading categories...' : 'Select categories'}
                />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem
                    key={category.slug}
                    value={category.slug}
                    disabled={formData.categories.includes(category.slug)}
                  >
                    {category.icon && `${category.icon} `}
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {formData.categories.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.categories.map((categorySlug) => {
                  const category = categories.find((c) => c.slug === categorySlug);
                  return (
                    <Badge key={categorySlug} variant="secondary">
                      {category?.icon && `${category.icon} `}
                      {category?.name}
                      <button
                        type="button"
                        onClick={() => handleRemoveCategory(categorySlug)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Add tags (press Enter)"
              />
              <Button type="button" size="icon" variant="outline" onClick={handleAddTag}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Icon URL */}
          <div className="space-y-2">
            <Label htmlFor={iconUrlId}>Icon URL (optional)</Label>
            <Input
              id={iconUrlId}
              value={formData.iconUrl}
              onChange={(e) => handleInputChange('iconUrl', e.target.value)}
              placeholder="https://example.com/icon.png"
            />
            <p className="text-xs text-muted-foreground">
              Provide a URL to an icon image for your agent (recommended: 256x256px)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPublishing}>
            Cancel
          </Button>
          <Button onClick={handlePublish} disabled={isPublishing || !isAuthenticated}>
            {isPublishing ? 'Publishing...' : 'Publish to Marketplace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
