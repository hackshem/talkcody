/**
 * Tests for AgentSkillService
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSkillService } from './agent-skill-service';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/path', () => ({
	appDataDir: vi.fn().mockResolvedValue('/mock/app/data'),
	join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
	isAbsolute: vi.fn((path: string) => Promise.resolve(path.startsWith('/'))),
	normalize: vi.fn((path: string) => Promise.resolve(path)),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	exists: vi.fn(),
	mkdir: vi.fn(),
	readDir: vi.fn(),
	readTextFile: vi.fn(),
	readFile: vi.fn(),
	writeTextFile: vi.fn(),
	writeFile: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('./claude-code-importer', () => ({
	ClaudeCodeImporter: {
		getClaudeCodeSkillDirs: vi.fn().mockResolvedValue([]),
	},
}));

// Import mocked modules
import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';

describe('AgentSkillService', () => {
	let service: AgentSkillService;

	beforeEach(async () => {
		vi.clearAllMocks();
		service = new AgentSkillService();

		// Default mock implementations
		vi.mocked(exists).mockResolvedValue(true);
		vi.mocked(mkdir).mockResolvedValue();
		vi.mocked(writeTextFile).mockResolvedValue();
		vi.mocked(remove).mockResolvedValue();
	});

	describe('initialize', () => {
		it('should create skills directory if it does not exist', async () => {
			vi.mocked(exists).mockResolvedValue(false);

			await service.initialize();

			expect(mkdir).toHaveBeenCalledWith('/mock/app/data/skills', { recursive: true });
		});

		it('should not create directory if it already exists', async () => {
			vi.mocked(exists).mockResolvedValue(true);

			await service.initialize();

			expect(mkdir).not.toHaveBeenCalled();
		});
	});

	describe('listSkills', () => {
		it('should list all valid skills', async () => {
			vi.mocked(readDir).mockResolvedValue([
				{ isDirectory: true, name: 'skill-one', isFile: false, isSymlink: false },
				{ isDirectory: true, name: 'skill-two', isFile: false, isSymlink: false },
				{ isDirectory: false, name: 'file.txt', isFile: true, isSymlink: false },
			]);

			// Mock different content for each skill
			vi.mocked(readTextFile).mockImplementation(async (path: string) => {
				if (path.includes('skill-one')) {
					return `---
name: skill-one
description: First test skill
---

Content`;
				}
				if (path.includes('skill-two')) {
					return `---
name: skill-two
description: Second test skill
---

Content`;
				}
				return '';
			});

			const skills = await service.listSkills();

			expect(skills).toHaveLength(2);
			expect(skills[0]?.name).toBe('skill-one');
			expect(skills[1]?.name).toBe('skill-two');
		});

		it('should include skills from Claude Code directories', async () => {
			const { ClaudeCodeImporter } = await import('./claude-code-importer');

			vi.mocked(readDir).mockImplementation(async (path: string) => {
				if (path === '/mock/app/data/skills') {
					return [
						{ isDirectory: true, name: 'local-skill', isFile: false, isSymlink: false },
					];
				}
				if (path === '/mock/claude/skills') {
					return [
						{ isDirectory: true, name: 'claude-skill', isFile: false, isSymlink: false },
					];
				}
				return [];
			});

			vi.mocked(ClaudeCodeImporter.getClaudeCodeSkillDirs).mockResolvedValue([
				{ path: '/mock/claude/skills', type: 'personal' },
			]);

			vi.mocked(readTextFile).mockImplementation(async (path: string) => {
				if (path.includes('local-skill')) {
					return `---
name: local-skill
description: Local skill
---

Content`;
				}
				if (path.includes('claude-skill')) {
					return `---
name: claude-skill
description: Claude skill
---

Content`;
				}
				return '';
			});

			const skills = await service.listSkills();

			expect(skills).toHaveLength(2);
			expect(skills.map((skill) => skill.name)).toEqual(['local-skill', 'claude-skill']);
		});

		it('should skip directories without SKILL.md', async () => {
			vi.mocked(readDir).mockResolvedValue([
				{ isDirectory: true, name: 'invalid-skill', isFile: false, isSymlink: false },
			]);

			vi.mocked(exists).mockImplementation(async (path: string) => {
				return !path.includes('SKILL.md');
			});

			const skills = await service.listSkills();

			expect(skills).toHaveLength(0);
		});
	});

	describe('loadSkill', () => {
		it('should load a valid skill', async () => {
			const skillContent = `---
name: test-skill
description: A test skill for unit testing
license: MIT
---

# Test Skill

This is test content.`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);

			const skill = await service.loadSkill('test-skill');

			expect(skill).not.toBeNull();
			expect(skill?.name).toBe('test-skill');
			expect(skill?.frontmatter.description).toBe('A test skill for unit testing');
			expect(skill?.frontmatter.license).toBe('MIT');
			expect(skill?.content).toContain('# Test Skill');
		});

		it('should return null for non-existent skill', async () => {
			vi.mocked(exists).mockResolvedValue(false);

			const skill = await service.loadSkill('non-existent');

			expect(skill).toBeNull();
		});

		it('should return null if directory name does not match skill name', async () => {
			const skillContent = `---
name: different-name
description: Test
---

Content`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);

			const skill = await service.loadSkill('test-skill');

			expect(skill).toBeNull();
		});
	});

	describe('createSkill', () => {
		it('should create a new skill with valid parameters', async () => {
			let skillCreated = false;
			vi.mocked(exists).mockImplementation(async (path: string) => {
				if (path.includes('test-skill')) {
					return skillCreated;
				}
				return path.includes('app/data/skills');
			});

			// Mock mkdir to mark skill as created
			vi.mocked(mkdir).mockImplementation(async () => {
				skillCreated = true;
			});

			// Mock readTextFile to return the created skill content
			vi.mocked(readTextFile).mockResolvedValue(`---
name: test-skill
description: A test skill
---

# Test

Content here`);

			// Mock readDir to simulate empty directories
			vi.mocked(readDir).mockResolvedValue([]);

			const skill = await service.createSkill({
				name: 'Test Skill',
				description: 'A test skill',
				content: '# Test\n\nContent here',
			});

			expect(mkdir).toHaveBeenCalledWith('/mock/app/data/skills/test-skill', { recursive: true });
			expect(writeTextFile).toHaveBeenCalled();
			expect(skill.name).toBe('test-skill');
		});

		it('should normalize skill name', async () => {
			let skillCreated = false;
			vi.mocked(exists).mockImplementation(async (path: string) => {
				if (path.includes('my-skill')) {
					return skillCreated;
				}
				return path.includes('app/data/skills');
			});

			// Mock mkdir to mark skill as created
			vi.mocked(mkdir).mockImplementation(async () => {
				skillCreated = true;
			});

			// Mock readTextFile to return the created skill content
			vi.mocked(readTextFile).mockResolvedValue(`---
name: my-skill
description: Test
---

Content`);

			// Mock readDir to simulate empty directories
			vi.mocked(readDir).mockResolvedValue([]);

			await service.createSkill({
				name: 'My Skill!!!',
				description: 'Test',
				content: 'Content',
			});

			expect(mkdir).toHaveBeenCalledWith('/mock/app/data/skills/my-skill', { recursive: true });
		});

		it('should throw error if skill already exists', async () => {
			vi.mocked(exists).mockResolvedValue(true);

			await expect(
				service.createSkill({
					name: 'existing-skill',
					description: 'Test',
					content: 'Content',
				}),
			).rejects.toThrow('already exists');
		});

		it('should throw error for invalid name', async () => {
			await expect(
				service.createSkill({
					name: '', // Invalid: empty
					description: 'Test',
					content: 'Content',
				}),
			).rejects.toThrow('Invalid skill');
		});
	});

	describe('updateSkill', () => {
		it('should update skill frontmatter and content', async () => {
			const skillContent = `---
name: test-skill
description: Original description
---

Original content`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);

			await service.updateSkill('test-skill', {
				description: 'Updated description',
				content: 'Updated content',
			});

			expect(writeTextFile).toHaveBeenCalled();
			const writtenContent = vi.mocked(writeTextFile).mock.calls[0]?.[1];
			expect(writtenContent).toContain('Updated description');
			expect(writtenContent).toContain('Updated content');
		});

		it('should throw error for non-existent skill', async () => {
			vi.mocked(exists).mockResolvedValue(false);

			await expect(
				service.updateSkill('non-existent', {
					description: 'Test',
				}),
			).rejects.toThrow('not found');
		});

		it('should prevent skill renaming', async () => {
			const skillContent = `---
name: test-skill
description: Test
---

Content`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);

			await expect(
				service.updateSkill('test-skill', { description: 'Test' }, { name: 'different-name' }),
			).rejects.toThrow('Skill renaming is not allowed');
		});
	});

	describe('deleteSkill', () => {
		it('should delete a skill', async () => {
			vi.mocked(exists).mockResolvedValue(true);

			await service.deleteSkill('test-skill');

			expect(remove).toHaveBeenCalledWith('/mock/app/data/skills/test-skill', {
				recursive: true,
			});
		});

		it('should throw error for non-existent skill', async () => {
			vi.mocked(exists).mockResolvedValue(false);

			await expect(service.deleteSkill('non-existent')).rejects.toThrow('not found');
		});
	});

	describe('getReference', () => {
		it('should get reference file content', async () => {
			const skillContent = `---
name: test-skill
description: Test
---

Content`;

			vi.mocked(readTextFile).mockImplementation(async (path: string) => {
				if (path.includes('SKILL.md')) {
					return skillContent;
				}
				if (path.includes('REFERENCE.md')) {
					return '# Reference Content';
				}
				return '';
			});

			vi.mocked(readDir).mockResolvedValue([]);

			const content = await service.getReference('test-skill', 'REFERENCE.md');

			expect(content).toBe('# Reference Content');
		});

		it('should throw error if reference file does not exist', async () => {
			const skillContent = `---
name: test-skill
description: Test
---

Content`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);
			vi.mocked(exists).mockImplementation(async (path: string) => {
				return !path.includes('references');
			});

			await expect(service.getReference('test-skill', 'missing.md')).rejects.toThrow(
				'not found',
			);
		});
	});

	describe('addReference', () => {
		it('should add a reference file to a skill', async () => {
			const skillContent = `---
name: test-skill
description: Test
---

Content`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);
			vi.mocked(exists).mockImplementation(async (path: string) => {
				return !path.includes('references');
			});

			await service.addReference('test-skill', 'guide.md', '# Guide\n\nContent');

			expect(mkdir).toHaveBeenCalledWith('/mock/app/data/skills/test-skill/references', {
				recursive: true,
			});
			expect(writeTextFile).toHaveBeenCalled();
		});
	});

	describe('addScript', () => {
		it('should add a script file to a skill', async () => {
			const skillContent = `---
name: test-skill
description: Test
---

Content`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);
			vi.mocked(exists).mockImplementation(async (path: string) => {
				return !path.includes('scripts');
			});

			await service.addScript('test-skill', 'test.py', 'print("Hello")');

			expect(mkdir).toHaveBeenCalledWith('/mock/app/data/skills/test-skill/scripts', {
				recursive: true,
			});
			expect(writeTextFile).toHaveBeenCalled();
		});
	});

	describe('Security: Path Traversal Prevention', () => {
		const setupSkill = () => {
			const skillContent = `---
name: test-skill
description: Test
---

Content`;
			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);
		};

		it('should reject path traversal in getReference', async () => {
			setupSkill();
			await expect(service.getReference('test-skill', '../../../etc/passwd')).rejects.toThrow(
				'parent directory references',
			);
		});

		it('should reject absolute paths in getAssetPath', async () => {
			setupSkill();
			await expect(service.getAssetPath('test-skill', '/etc/passwd')).rejects.toThrow(
				'absolute path',
			);
		});

		it('should reject path separators in getScriptPath', async () => {
			setupSkill();
			await expect(service.getScriptPath('test-skill', 'subdir/script.sh')).rejects.toThrow(
				'path separators',
			);
		});

		it('should reject suspicious patterns in addReference', async () => {
			setupSkill();
			// Mock exists to allow loadSkill but fail on references dir
			vi.mocked(exists).mockImplementation(async (path: string) => {
				return !path.includes('references');
			});
			// ./ is caught by path separators check
			await expect(service.addReference('test-skill', './secret.txt', 'data')).rejects.toThrow(
				'path separators',
			);
		});

		it('should reject empty filenames in addAsset', async () => {
			setupSkill();
			// Mock exists to allow loadSkill but fail on assets dir
			vi.mocked(exists).mockImplementation(async (path: string) => {
				return !path.includes('assets');
			});
			const emptyData = new Uint8Array([]);
			await expect(service.addAsset('test-skill', '  ', emptyData)).rejects.toThrow(
				'cannot be empty',
			);
		});

		it('should accept valid filenames', async () => {
			setupSkill();
			// Mock exists to allow loadSkill but fail on scripts dir
			vi.mocked(exists).mockImplementation(async (path: string) => {
				return !path.includes('scripts');
			});
			await service.addScript('test-skill', 'valid-script.py', 'print("ok")');
			expect(writeTextFile).toHaveBeenCalled();
		});
	});

	describe('Performance: getSkillByName optimization', () => {
		it('should load skill directly without listing all skills', async () => {
			const skillContent = `---
name: my-skill
description: Test
---

Content`;

			vi.mocked(readTextFile).mockResolvedValue(skillContent);
			vi.mocked(readDir).mockResolvedValue([]);

			const skill = await service.getSkillByName('My Skill!!!');

			// Should not call readDir for listing all skills
			expect(readDir).not.toHaveBeenCalledWith('/mock/app/data/skills');
			// Should load the normalized skill directly
			expect(skill?.name).toBe('my-skill');
		});
	});
});

