#!/usr/bin/env python3
"""
LaTeX Project Analyzer

A utility script to analyze LaTeX projects and extract:
- File dependencies and structure
- Paper metadata (title, authors, abstract, keywords)
- Document outline (table of contents structure)
- Custom commands and environments
- All related files (tex, bib, images)

Usage:
    python latex_analyzer.py [OPTIONS] <project_directory>

Options:
    -m, --main FILE       Specify main .tex file (auto-detected if not provided)
    -f, --format FORMAT   Output format: tree, json, flat, outline, metadata, files, report (default: tree)
    -o, --output FILE     Write output to file instead of stdout
    -i, --include-gen     Include generated files (.aux, .log, .toc, etc.)
    -v, --verbose         Show detailed processing information
    -h, --help            Show this help message

Examples:
    python latex_analyzer.py ./thesis
    python latex_analyzer.py -m main.tex -f metadata ./project
    python latex_analyzer.py -f outline ./paper
    python latex_analyzer.py -f files ./project    # List all related files
    python latex_analyzer.py -f json -o analysis.json ./project
"""

import os
import re
import sys
import json
import argparse
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Set, Tuple, Any
from collections import defaultdict


@dataclass
class DocumentMetadata:
    """Paper/document metadata extracted from LaTeX."""
    title: Optional[str] = None
    subtitle: Optional[str] = None
    authors: List[Dict] = field(default_factory=list)  # List of {'name', 'email', 'affiliations'}
    affiliations: List[str] = field(default_factory=list)  # All unique affiliations
    date: Optional[str] = None
    abstract: Optional[str] = None
    keywords: List[str] = field(default_factory=list)
    thanks: Optional[str] = None  # Acknowledgments footnote
    doi: Optional[str] = None
    email: Optional[str] = None

    def to_dict(self) -> Dict:
        """Convert to dictionary, filtering out empty values."""
        result = {}
        if self.title:
            result['title'] = self.title
        if self.subtitle:
            result['subtitle'] = self.subtitle
        if self.authors:
            # For backward compatibility, also provide simple author names list
            result['authors'] = self.authors
            result['author_names'] = [a.get('name', '') for a in self.authors if a.get('name')]
        if self.affiliations:
            # Deduplicate affiliations while preserving order
            seen = set()
            unique_affiliations = []
            for aff in self.affiliations:
                if aff and aff not in seen:
                    seen.add(aff)
                    unique_affiliations.append(aff)
            result['affiliations'] = unique_affiliations
        if self.date:
            result['date'] = self.date
        if self.abstract:
            result['abstract'] = self.abstract
        if self.keywords:
            result['keywords'] = self.keywords
        if self.thanks:
            result['thanks'] = self.thanks
        if self.doi:
            result['doi'] = self.doi
        if self.email:
            result['email'] = self.email
        return result


@dataclass
class TOCEntry:
    """Table of contents entry."""
    level: int  # 0=part, 1=chapter, 2=section, 3=subsection, 4=subsubsection
    type: str   # part, chapter, section, subsection, subsubsection, paragraph
    number: Optional[str] = None
    title: str = ""
    label: Optional[str] = None
    file: Optional[str] = None  # Source file where defined
    line: Optional[int] = None
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class LaTeXFile:
    """Represents a LaTeX file and its dependencies."""
    path: str
    exists: bool = True
    includes: List[str] = field(default_factory=list)
    imports: List[Tuple[str, str]] = field(default_factory=list)
    bibliographies: List[str] = field(default_factory=list)
    graphics: List[str] = field(default_factory=list)
    packages: List[str] = field(default_factory=list)
    custom_commands: List[Dict] = field(default_factory=list)
    environments: List[Dict] = field(default_factory=list)
    is_main: bool = False
    document_class: Optional[str] = None
    document_options: List[str] = field(default_factory=list)


class LaTeXAnalyzer:
    """Analyzes LaTeX projects to extract structure and metadata."""

    # Regex patterns for parsing LaTeX commands
    PATTERNS = {
        'documentclass': re.compile(r'\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}'),
        'input': re.compile(r'\\input\s*\{([^}]+)\}'),
        'include': re.compile(r'\\include\s*\{([^}]+)\}'),
        'import': re.compile(r'\\import\s*\{([^}]*)\}\s*\{([^}]+)\}'),
        'subimport': re.compile(r'\\subimport\s*\{([^}]*)\}\s*\{([^}]+)\}'),
        'includefrom': re.compile(r'\\includefrom\s*\{([^}]*)\}\s*\{([^}]+)\}'),
        'bibliography': re.compile(r'\\bibliography\s*\{([^}]+)\}'),
        'addbibresource': re.compile(r'\\addbibresource\s*\{([^}]+)\}'),
        'includegraphics': re.compile(r'\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}'),
        'usepackage': re.compile(r'\\usepackage(?:\[([^\]]*)\])?\s*\{([^}]+)\}'),
        'graphicspath': re.compile(r'\\graphicspath\s*(?:\{([^}]+)\}|\(([^)]+)\))'),
        'includeonly': re.compile(r'\\includeonly\s*\{([^}]+)\}'),

        # Metadata patterns
        'title': re.compile(r'\\title(?:\[[^\]]*\])?\s*\{'),
        'subtitle': re.compile(r'\\subtitle(?:\[[^\]]*\])?\s*\{'),
        'author': re.compile(r'\\author(?:\[[^\]]*\])?\s*\{'),
        'date': re.compile(r'\\date\s*\{([^}]+)\}'),
        'thanks': re.compile(r'\\thanks\s*\{([^}]+)\}'),
        'email': re.compile(r'\\email\s*\{([^}]+)\}'),
        'keywords': re.compile(r'\\keywords\s*\{([^}]+)\}'),

        # JMLR/ACM specific author patterns
        # Pattern 1: \name Name \email... or \name Name \thanks...
        # Note: \\ is line break in LaTeX, we skip it when matching names
        # (?:[^%\n\\\\]|\\\\(?!\\\\))* matches chars except %/\n, allowing \\ as line break
        'jmlr_name': re.compile(r'\\name\s+((?:[^%\n\\\\]|\\\\)+?)(?:\\email|\\thanks|\\AND|\\\\|$)', re.MULTILINE),
        # Pattern 2: \AND Name \email... (without explicit \name) - for use before splitting
        'jmlr_author_inline': re.compile(r'\\AND\s+([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+\\email', re.MULTILINE),
        # Pattern 3: Name \email... (for use after splitting by \AND)
        'jmlr_author_simple': re.compile(r'^\s*([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+\\email', re.MULTILINE),
        # Pattern 4: \email{address} or \email address (both formats)
        'jmlr_email': re.compile(r'\\email\s*(?:\{([^}]+)\}|([^\s\\\\]+))'),
        # Pattern 5: \addr - we'll extract the full address block and split manually
        'jmlr_addr': re.compile(r'\\addr\s+'),
        'jmlr_and': re.compile(r'\\AND'),

        # Abstract environment
        'abstract_start': re.compile(r'\\begin\s*\{abstract\}'),
        'abstract_end': re.compile(r'\\end\s*\{abstract\}'),

        # Sectioning commands
        'part': re.compile(r'\\part(?:\*)?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'chapter': re.compile(r'\\chapter(?:\*)?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'section': re.compile(r'\\section(?:\*)?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'subsection': re.compile(r'\\subsection(?:\*)?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'subsubsection': re.compile(r'\\subsubsection(?:\*)?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'paragraph': re.compile(r'\\paragraph(?:\*)?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),

        # Label
        'label': re.compile(r'\\label\s*\{([^}]+)\}'),

        # Custom commands
        'newcommand': re.compile(r'\\newcommand\s*\{?\\([a-zA-Z]+)\}?(?:\[([0-9]+)\])?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'renewcommand': re.compile(r'\\renewcommand\s*\{?\\([a-zA-Z]+)\}?(?:\[([0-9]+)\])?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'newenvironment': re.compile(r'\\newenvironment\s*\{([^}]+)\}(?:\[([0-9]+)\])?(?:\[([^\]]*)\])?\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'newtheorem': re.compile(r'\\newtheorem\s*\{([^}]+)\}\s*\{([^}]+)\}(?:\[([^\]]+)\])?'),
        'DeclareMathOperator': re.compile(r'\\DeclareMathOperator\s*\{?\\([a-zA-Z]+)\}?\s*\{([^}]+)\}'),

        # ACM/IEEE specific
        'acm_title': re.compile(r'\\title\s*\[([^\]]*)\]\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}'),
        'acm_author': re.compile(r'\\author\[[^\]]*\]\{([^}]+)\}'),
        'affiliation': re.compile(r'\\affiliation\s*\{([^}]+)\}'),
    }

    # Generated file extensions to ignore by default
    GENERATED_EXTENSIONS = {
        '.aux', '.log', '.toc', '.lof', '.lot', '.fls',
        '.fdb_latexmk', '.bbl', '.blg', '.out', '.synctex.gz',
        '.nav', '.snm', '.vrb', '.idx', '.ilg', '.ind',
        '.glo', '.gls', '.glg', '.acn', '.acr', '.alg',
        '.ist', '.xdy', '.run.xml', '.bcf', '.xml'
    }

    # Graphics extensions to look for
    GRAPHICS_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.ps', '.svg']
    
    # Section hierarchy
    SECTION_LEVELS = {
        'part': 0,
        'chapter': 1,
        'section': 2,
        'subsection': 3,
        'subsubsection': 4,
        'paragraph': 5,
    }

    def __init__(self, project_dir: str, verbose: bool = False, include_generated: bool = False):
        self.project_dir = Path(project_dir).resolve()
        self.verbose = verbose
        self.include_generated = include_generated
        self.files: Dict[str, LaTeXFile] = {}
        self.graphics_paths: List[str] = ['']
        self.includeonly: Optional[Set[str]] = None
        self.main_file: Optional[str] = None
        self.metadata = DocumentMetadata()
        self.toc_entries: List[TOCEntry] = []
        self.section_counters: Dict[str, int] = defaultdict(int)
        self.all_content: str = ""  # Concatenated content for analysis

    def log(self, message: str):
        """Print verbose logging message."""
        if self.verbose:
            print(f"[INFO] {message}", file=sys.stderr)

    def find_main_file(self) -> Optional[str]:
        """Find the main LaTeX document (contains \\documentclass)."""
        self.log(f"Searching for main document in {self.project_dir}")

        # Common main file names to check first
        common_names = ['main.tex', 'document.tex', 'paper.tex', 'thesis.tex',
                        'dissertation.tex', 'report.tex', 'article.tex', 'book.tex']

        for name in common_names:
            path = self.project_dir / name
            if path.exists():
                content = self._read_file(str(path))
                if content and self.PATTERNS['documentclass'].search(content):
                    self.log(f"Found main file: {path}")
                    return str(path)

        # Search all .tex files for \documentclass
        for tex_file in self.project_dir.rglob('*.tex'):
            if not self._should_ignore_file(str(tex_file)):
                content = self._read_file(str(tex_file))
                if content and self.PATTERNS['documentclass'].search(content):
                    self.log(f"Found main file: {tex_file}")
                    return str(tex_file)

        return None

    def _should_ignore_file(self, filepath: str) -> bool:
        """Check if file should be ignored."""
        path = Path(filepath)
        for part in path.parts:
            if part.startswith('.'):
                return True
        if not self.include_generated:
            for ext in self.GENERATED_EXTENSIONS:
                if filepath.endswith(ext):
                    return True
        return False

    def _read_file(self, filepath: str) -> Optional[str]:
        """Read file content with error handling."""
        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                return f.read()
        except Exception as e:
            self.log(f"Error reading {filepath}: {e}")
            return None

    def _resolve_input_path(self, include_path: str, base_dir: str, is_include: bool = False) -> Optional[str]:
        """Resolve the actual file path from an include command."""
        base = Path(base_dir)
        if is_include:
            main_dir = Path(self.main_file).parent if self.main_file else self.project_dir
            candidate = main_dir / f"{include_path}.tex"
            if candidate.exists():
                return str(candidate)
            return None

        paths_to_try = [
            base / include_path,
            base / f"{include_path}.tex",
            self.project_dir / include_path,
            self.project_dir / f"{include_path}.tex",
        ]

        for path in paths_to_try:
            if path.exists():
                return str(path.resolve())

        if not include_path.endswith('.tex'):
            return str((base / f"{include_path}.tex").resolve())
        return str((base / include_path).resolve())

    def _resolve_import_path(self, import_path: str, filename: str) -> Optional[str]:
        """Resolve path from \\import{path}{file} command."""
        main_dir = Path(self.main_file).parent if self.main_file else self.project_dir
        paths_to_try = [
            main_dir / import_path / filename,
            main_dir / import_path / f"{filename}.tex",
            self.project_dir / import_path / filename,
            self.project_dir / import_path / f"{filename}.tex",
        ]

        for path in paths_to_try:
            if path.exists():
                return str(path.resolve())

        if not filename.endswith('.tex'):
            return str((main_dir / import_path / f"{filename}.tex").resolve())
        return str((main_dir / import_path / filename).resolve())

    def _clean_latex_text(self, text: str) -> str:
        """Clean LaTeX formatting from text."""
        if not text:
            return ""

        # Remove LaTeX comments (unescaped %)
        text = self._remove_comments(text)

        # Remove line breaks (\\) - used in author blocks
        text = re.sub(r'\\\\\s*', ' ', text)

        # Remove common LaTeX commands but keep content
        text = re.sub(r'\\textbf\s*\{([^}]*)\}', r'\1', text)
        text = re.sub(r'\\textit\s*\{([^}]*)\}', r'\1', text)
        text = re.sub(r'\\emph\s*\{([^}]*)\}', r'\1', text)
        text = re.sub(r'\\texttt\s*\{([^}]*)\}', r'\1', text)
        text = re.sub(r'\\textrm\s*\{([^}]*)\}', r'\1', text)
        text = re.sub(r'\\textsf\s*\{([^}]*)\}', r'\1', text)
        text = re.sub(r'\\textsc\s*\{([^}]*)\}', r'\1', text)
        text = re.sub(r'\\underline\s*\{([^}]*)\}', r'\1', text)

        # Remove math mode delimiters
        text = re.sub(r'\$([^$]+)\$', r'\1', text)
        text = re.sub(r'\\\[|\\\]', '', text)

        # Remove remaining simple commands
        text = re.sub(r'\\[a-zA-Z]+\s*', ' ', text)
        text = re.sub(r'[{}]', '', text)

        # Clean whitespace
        text = re.sub(r'\s+', ' ', text)
        text = text.strip()

        return text

    def _remove_comments(self, text: str) -> str:
        """
        Remove LaTeX comments from text.
        % starts a comment (unless escaped as \\%)
        Comment extends to end of line
        """
        if not text:
            return ""
        
        lines = text.split('\n')
        result = []
        for line in lines:
            # Find unescaped %
            cleaned_line = self._remove_line_comment(line)
            result.append(cleaned_line)
        return '\n'.join(result)

    def _remove_line_comment(self, line: str) -> str:
        """
        Remove comment from a single line.
        Handles \\% as escaped percent (not a comment starter).
        """
        result = []
        i = 0
        while i < len(line):
            char = line[i]
            if char == '%':
                # Check if escaped (preceded by odd number of backslashes)
                num_backslashes = 0
                j = i - 1
                while j >= 0 and line[j] == '\\':
                    num_backslashes += 1
                    j -= 1
                
                if num_backslashes % 2 == 0:
                    # Even number of backslashes = unescaped % = start of comment
                    break
                else:
                    # Odd number = escaped \%, keep it
                    result.append(char)
            else:
                result.append(char)
            i += 1
        return ''.join(result)

    def _extract_balanced_braces(self, content: str, start_pos: int) -> Optional[str]:
        """
        Extract content within balanced braces starting from start_pos.
        start_pos should point to the opening brace '{'.
        Returns the content inside braces (excluding the braces themselves).
        """
        if start_pos >= len(content) or content[start_pos] != '{':
            return None

        depth = 0
        content_start = start_pos + 1
        pos = start_pos

        while pos < len(content):
            char = content[pos]
            # Handle escaped characters
            if char == '\\' and pos + 1 < len(content):
                pos += 2
                continue
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    return content[content_start:pos]
            pos += 1

        return None  # Unbalanced braces

    def _parse_authors(self, author_text: str) -> List[str]:
        """Parse author string into list of authors."""
        if not author_text:
            return []

        # Handle \and separator
        authors = re.split(r'\\and', author_text, flags=re.IGNORECASE)

        # Also split on common separators
        result = []
        for a in authors:
            a = a.strip()
            if not a:
                continue
            # Check for comma separation (but be careful with "Last, First")
            if ',' in a and not re.search(r'\\textsuperscript', a):
                # Likely "First Last, First Last" format
                parts = a.split(',')
                for p in parts:
                    p = self._clean_latex_text(p)
                    if p:
                        result.append(p)
            else:
                a = self._clean_latex_text(a)
                if a:
                    result.append(a)

        return result

    def _parse_jmlr_authors(self, content: str) -> Tuple[List[Dict], List[str]]:
        """
        Parse JMLR/ACM style author block with \\name, \\addr, \\AND.
        
        Returns:
            authors: List of dicts with 'name', 'email', 'affiliations' keys
            all_affiliations: List of all unique affiliations
        """
        authors = []
        all_affiliations = []
        seen_authors = set()
        seen_affiliations = set()

        # Find the \author{...} block using balanced brace extraction
        author_match = self.PATTERNS['author'].search(content)
        if not author_match:
            return authors, all_affiliations

        # Extract content inside balanced braces
        author_block = self._extract_balanced_braces(content, author_match.end() - 1)
        if not author_block:
            return authors, all_affiliations
        
        # Split by \AND to get individual author entries
        author_entries = self.PATTERNS['jmlr_and'].split(author_block)

        for entry in author_entries:
            entry = entry.strip()
            if not entry:
                continue

            # Extract name
            name_match = self.PATTERNS['jmlr_name'].search(entry)
            if not name_match:
                # Try inline format: \AND Name \email (before splitting)
                inline_match = self.PATTERNS['jmlr_author_inline'].search(entry)
                if inline_match:
                    name = inline_match.group(1).strip()
                else:
                    # Try simple format: Name \email (after splitting by \AND)
                    simple_match = self.PATTERNS['jmlr_author_simple'].search(entry)
                    if simple_match:
                        name = simple_match.group(1).strip()
                    else:
                        continue
            else:
                name = name_match.group(1).strip()

            if not name:
                continue

            cleaned_name = self._clean_latex_text(name)
            if not cleaned_name or cleaned_name in seen_authors:
                continue
            seen_authors.add(cleaned_name)

            # Extract email
            email = ""
            email_match = self.PATTERNS['jmlr_email'].search(entry)
            if email_match:
                # Handle both \email{...} and \email ... formats
                email = email_match.group(1) or email_match.group(2) or ""
                email = email.strip()

            # Extract all affiliations (\addr can have multiple lines)
            affiliations = []

            # Find all \addr positions and extract content until next \AND, \name, \email, or \addr
            addr_starts = [m.end() for m in self.PATTERNS['jmlr_addr'].finditer(entry)]

            for start_pos in addr_starts:
                # Find the end of this address block (next command or end of entry)
                remaining = entry[start_pos:]

                # Find next LaTeX command that ends the address
                end_match = re.search(r'\s*(?:\\AND|\\name|\\email|\\addr)\s*', remaining)
                if end_match:
                    addr_text = remaining[:end_match.start()].strip()
                else:
                    addr_text = remaining.strip()

                if addr_text:
                    # Parse multi-line affiliations:
                    # - Lines ending with ", \\" continue to next line (same affiliation)
                    # - Lines ending with just "\\" are complete affiliations
                    addr_lines = re.split(r'\\\\\s*', addr_text)
                    
                    current_affiliation = []
                    for line in addr_lines:
                        line_stripped = line.strip()
                        if not line_stripped:
                            continue
                        
                        # Check if line ends with comma (continues to next line)
                        ends_with_comma = line_stripped.rstrip().endswith(',')
                        
                        # Clean the line but preserve comma for continuation
                        if ends_with_comma:
                            # Remove trailing comma, we'll add proper punctuation when joining
                            cleaned_line = self._clean_latex_text(line_stripped.rstrip(',').rstrip())
                        else:
                            cleaned_line = self._clean_latex_text(line_stripped)
                        
                        if cleaned_line:
                            current_affiliation.append(cleaned_line)
                        
                        if not ends_with_comma:
                            # This line completes the affiliation
                            if current_affiliation:
                                full_affiliation = ", ".join(current_affiliation)
                                if full_affiliation and len(full_affiliation) > 10:
                                    affiliations.append(full_affiliation)
                                    all_affiliations.append(full_affiliation)
                            current_affiliation = []
                    
                    # Handle any remaining affiliation
                    if current_affiliation:
                        full_affiliation = ", ".join(current_affiliation)
                        if full_affiliation and len(full_affiliation) > 10:
                            affiliations.append(full_affiliation)
                            all_affiliations.append(full_affiliation)

            authors.append({
                'name': cleaned_name,
                'email': email,
                'affiliations': affiliations
            })

        return authors, all_affiliations

    def extract_metadata(self, content: str):
        """Extract document metadata from content."""
        # Title - use balanced brace extraction
        match = self.PATTERNS['title'].search(content)
        if match:
            title_block = self._extract_balanced_braces(content, match.end() - 1)
            if title_block:
                self.metadata.title = self._clean_latex_text(title_block)

        # Subtitle - use balanced brace extraction
        match = self.PATTERNS['subtitle'].search(content)
        if match:
            subtitle_block = self._extract_balanced_braces(content, match.end() - 1)
            if subtitle_block:
                self.metadata.subtitle = self._clean_latex_text(subtitle_block)

        # Authors - try JMLR/ACM format first, then standard format
        authors, affiliations = self._parse_jmlr_authors(content)
        if authors:
            self.metadata.authors = authors
            self.metadata.affiliations = affiliations
            # Set primary email from first author
            for author in authors:
                if author.get('email'):
                    self.metadata.email = author['email']
                    break
        else:
            # Fallback to standard \author pattern
            match = self.PATTERNS['author'].search(content)
            if match:
                author_block = self._extract_balanced_braces(content, match.end() - 1)
                if author_block:
                    author_names = self._parse_authors(author_block)
                    self.metadata.authors = [{'name': name, 'email': '', 'affiliations': []}
                                             for name in author_names]

        # Date
        match = self.PATTERNS['date'].search(content)
        if match:
            self.metadata.date = self._clean_latex_text(match.group(1))

        # Keywords
        match = self.PATTERNS['keywords'].search(content)
        if match:
            keywords = match.group(1).split(',')
            self.metadata.keywords = [self._clean_latex_text(k).strip() for k in keywords if k.strip()]

        # Thanks
        match = self.PATTERNS['thanks'].search(content)
        if match:
            self.metadata.thanks = self._clean_latex_text(match.group(1))

        # Extract abstract
        self._extract_abstract(content)

    def _extract_abstract(self, content: str):
        """Extract abstract text from content."""
        # Find abstract environment
        start_match = self.PATTERNS['abstract_start'].search(content)
        if not start_match:
            return
        
        start_pos = start_match.end()
        
        # Find matching \end{abstract}
        depth = 1
        pos = start_pos
        while depth > 0 and pos < len(content):
            next_start = content.find('\\begin{abstract}', pos)
            next_end = content.find('\\end{abstract}', pos)
            
            if next_end == -1:
                break
            
            if next_start != -1 and next_start < next_end:
                depth += 1
                pos = next_start + len('\\begin{abstract}')
            else:
                depth -= 1
                if depth == 0:
                    abstract_text = content[start_pos:next_end]
                    self.metadata.abstract = self._clean_latex_text(abstract_text)
                    return
                pos = next_end + len('\\end{abstract}')
        
        # Fallback: simple extraction
        end_match = self.PATTERNS['abstract_end'].search(content, start_pos)
        if end_match:
            abstract_text = content[start_pos:end_match.start()]
            self.metadata.abstract = self._clean_latex_text(abstract_text)

    def _generate_section_number(self, section_type: str) -> str:
        """Generate section number based on hierarchy."""
        level = self.SECTION_LEVELS.get(section_type, 0)
        
        # Reset lower-level counters
        for st, lvl in self.SECTION_LEVELS.items():
            if lvl > level:
                self.section_counters[st] = 0
        
        self.section_counters[section_type] += 1
        
        # Build number string
        parts = []
        for st in ['part', 'chapter', 'section', 'subsection', 'subsubsection']:
            if st == section_type:
                parts.append(str(self.section_counters[st]))
                break
            elif self.section_counters[st] > 0:
                parts.append(str(self.section_counters[st]))
        
        return '.'.join(parts) if parts else str(self.section_counters[section_type])

    def extract_toc(self, content: str, filepath: str):
        """Extract table of contents structure from content."""
        # Find all sectioning commands in order
        section_patterns = [
            ('part', self.PATTERNS['part']),
            ('chapter', self.PATTERNS['chapter']),
            ('section', self.PATTERNS['section']),
            ('subsection', self.PATTERNS['subsection']),
            ('subsubsection', self.PATTERNS['subsubsection']),
            ('paragraph', self.PATTERNS['paragraph']),
        ]
        
        # Find all matches with positions
        matches = []
        for section_type, pattern in section_patterns:
            for match in pattern.finditer(content):
                short_title = match.group(1) if match.lastindex >= 1 else None
                title = match.group(2) if match.lastindex >= 2 else match.group(1)
                title = self._clean_latex_text(title) if title else ""
                matches.append({
                    'pos': match.start(),
                    'type': section_type,
                    'short_title': short_title,
                    'title': title,
                })
        
        # Sort by position
        matches.sort(key=lambda x: x['pos'])
        
        # Look for labels after each section
        for i, m in enumerate(matches):
            pos = m['pos']
            # Search for label within next 500 chars or until next section
            end_pos = matches[i + 1]['pos'] if i + 1 < len(matches) else pos + 500
            label_match = self.PATTERNS['label'].search(content[pos:end_pos])
            label = label_match.group(1) if label_match else None
            
            # Generate section number
            number = self._generate_section_number(m['type'])
            
            entry = TOCEntry(
                level=self.SECTION_LEVELS[m['type']],
                type=m['type'],
                number=number,
                title=m['title'],
                label=label,
                file=filepath,
            )
            self.toc_entries.append(entry)

    def parse_file(self, filepath: str, is_main: bool = False) -> LaTeXFile:
        """Parse a LaTeX file and extract its dependencies."""
        filepath = str(Path(filepath).resolve())

        if filepath in self.files:
            return self.files[filepath]

        self.log(f"Parsing: {filepath}")

        content = self._read_file(filepath)
        if content is None:
            return LaTeXFile(path=filepath, exists=False)

        # Append to all_content for full document analysis
        self.all_content += f"\n% === {filepath} ===\n{content}"

        latex_file = LaTeXFile(path=filepath, is_main=is_main)

        # Extract document class
        match = self.PATTERNS['documentclass'].search(content)
        if match:
            latex_file.document_class = match.group(2)
            if match.group(1):
                latex_file.document_options = [o.strip() for o in match.group(1).split(',')]

        # Extract metadata (only from main file)
        if is_main:
            self.extract_metadata(content)

        # Extract TOC entries
        self.extract_toc(content, filepath)

        # Extract includes
        for match in self.PATTERNS['input'].finditer(content):
            input_path = match.group(1).strip()
            resolved = self._resolve_input_path(input_path, Path(filepath).parent)
            if resolved:
                latex_file.includes.append(resolved)

        for match in self.PATTERNS['include'].finditer(content):
            include_path = match.group(1).strip()
            resolved = self._resolve_input_path(include_path, Path(filepath).parent, is_include=True)
            if resolved:
                latex_file.includes.append(resolved)

        for pattern_name in ['import', 'subimport', 'includefrom']:
            for match in self.PATTERNS[pattern_name].finditer(content):
                import_path = match.group(1).strip()
                filename = match.group(2).strip()
                resolved = self._resolve_import_path(import_path, filename)
                if resolved:
                    latex_file.imports.append((import_path, resolved))

        # Bibliography
        for match in self.PATTERNS['bibliography'].finditer(content):
            bib_files = match.group(1).split(',')
            for bib in bib_files:
                bib = bib.strip()
                if not bib.endswith('.bib'):
                    bib += '.bib'
                latex_file.bibliographies.append(bib)

        for match in self.PATTERNS['addbibresource'].finditer(content):
            bib = match.group(1).strip()
            latex_file.bibliographies.append(bib)

        # Graphics
        for match in self.PATTERNS['includegraphics'].finditer(content):
            graphic = match.group(1).strip()
            latex_file.graphics.append(graphic)

        # Graphics path
        for match in self.PATTERNS['graphicspath'].finditer(content):
            paths = match.group(1)
            for path_match in re.finditer(r'\{([^}]+)\}', paths):
                self.graphics_paths.append(path_match.group(1))

        # Packages
        for match in self.PATTERNS['usepackage'].finditer(content):
            options = match.group(1).split(',') if match.group(1) else []
            packages = match.group(2).split(',')
            for pkg in packages:
                pkg = pkg.strip()
                latex_file.packages.append(pkg)

        # Custom commands
        for match in self.PATTERNS['newcommand'].finditer(content):
            latex_file.custom_commands.append({
                'name': match.group(1),
                'num_args': int(match.group(2)) if match.group(2) else 0,
                'default': match.group(3),
                'definition': match.group(4)[:100] + '...' if len(match.group(4)) > 100 else match.group(4),
            })

        for match in self.PATTERNS['DeclareMathOperator'].finditer(content):
            latex_file.custom_commands.append({
                'name': match.group(1),
                'num_args': 0,
                'definition': match.group(2),
            })

        # New environments
        for match in self.PATTERNS['newenvironment'].finditer(content):
            latex_file.environments.append({
                'name': match.group(1),
                'num_args': int(match.group(2)) if match.group(2) else 0,
            })

        # New theorems
        for match in self.PATTERNS['newtheorem'].finditer(content):
            latex_file.environments.append({
                'name': match.group(1),
                'display_name': match.group(2),
                'counter': match.group(3),
            })

        # Includeonly
        for match in self.PATTERNS['includeonly'].finditer(content):
            files = match.group(1).split(',')
            self.includeonly = {f.strip() for f in files}

        self.files[filepath] = latex_file
        return latex_file

    def analyze(self, main_file: Optional[str] = None) -> Dict[str, LaTeXFile]:
        """Analyze the entire project."""
        if main_file:
            self.main_file = str(Path(main_file).resolve())
        else:
            self.main_file = self.find_main_file()

        if not self.main_file:
            raise ValueError("Could not find main LaTeX document")

        # Reset counters
        self.section_counters = defaultdict(int)
        self.toc_entries = []

        self._parse_recursive(self.main_file, is_main=True)
        self._find_standalone_files()
        self._resolve_all_graphics()

        # Re-extract metadata from all content (handles split metadata)
        self._extract_metadata_from_all_content()

        return self.files

    def _parse_recursive(self, filepath: str, is_main: bool = False, visited: Optional[Set[str]] = None):
        """Recursively parse all included files."""
        if visited is None:
            visited = set()

        filepath = str(Path(filepath).resolve())

        if filepath in visited:
            return

        visited.add(filepath)

        latex_file = self.parse_file(filepath, is_main=is_main)

        for include_path in latex_file.includes:
            if not self._should_ignore_file(include_path):
                self._parse_recursive(include_path, visited=visited)

        for _, import_path in latex_file.imports:
            if not self._should_ignore_file(import_path):
                self._parse_recursive(import_path, visited=visited)

    def _find_standalone_files(self):
        """
        Find .bib files that are referenced from main document.
        Only include files that are actually used (via \\bibliography or \\addbibresource).
        Do NOT include standalone .tex files - only those included via \\input/\\include.
        """
        # Find all .bib files that are referenced
        referenced_bibs = set()
        for latex_file in self.files.values():
            for bib in latex_file.bibliographies:
                referenced_bibs.add(bib)
                referenced_bibs.add(bib + '.bib')
        
        # Only add referenced .bib files
        for bib_file in self.project_dir.rglob('*.bib'):
            bib_path = str(bib_file.resolve())
            bib_name = bib_file.name
            if not self._should_ignore_file(bib_path):
                if bib_name in referenced_bibs or bib_path in referenced_bibs:
                    self.log(f"Found referenced bibliography: {bib_path}")
                    self.files[bib_path] = LaTeXFile(path=bib_path, exists=True)

        # Find all image files that are actually referenced in the document
        self._discover_all_graphics_files()

    def _discover_all_graphics_files(self):
        """
        Discover graphics files that are actually referenced in the document.
        Only includes images that are referenced via \\includegraphics in included .tex files.
        """
        # Collect all referenced graphics names (with and without extension)
        referenced_graphics = set()
        for latex_file in self.files.values():
            if not latex_file.path.endswith('.tex'):
                continue
            for graphic in latex_file.graphics:
                # Store both full name and base name
                referenced_graphics.add(graphic)
                base_name = graphic.rsplit('.', 1)[0] if '.' in graphic else graphic
                referenced_graphics.add(base_name)
                # Also store just the filename without path
                graphic_filename = Path(graphic).name
                referenced_graphics.add(graphic_filename)
                referenced_graphics.add(Path(graphic).stem)

        if not referenced_graphics:
            return

        # Common image directories to search
        image_dirs = ['imgs', 'images', 'figures', 'figs', 'graphics', 'assets', 'img', 'figure']
        
        # Search in project root and common subdirectories
        search_dirs = [self.project_dir]
        for img_dir in image_dirs:
            img_path = self.project_dir / img_dir
            if img_path.exists() and img_path.is_dir():
                search_dirs.append(img_path)

        # Search for matching image files
        found_images = set()
        for search_dir in search_dirs:
            for ext in self.GRAPHICS_EXTENSIONS:
                for img_file in search_dir.glob(f'*{ext}'):
                    img_path = str(img_file.resolve())
                    img_name = img_file.name
                    img_base = img_file.stem
                    
                    # Check if this image is actually referenced
                    is_referenced = (img_name in referenced_graphics or 
                                    img_base in referenced_graphics or
                                    any(ref == img_name or ref == img_base or 
                                        Path(ref).name == img_name or 
                                        Path(ref).name == img_base 
                                        for ref in referenced_graphics))
                    
                    if is_referenced and img_path not in found_images:
                        self.log(f"Found referenced graphics file: {img_path}")
                        self.files[img_path] = LaTeXFile(path=img_path, exists=True)
                        found_images.add(img_path)

    def _resolve_all_graphics(self):
        """Try to resolve graphics file paths."""
        # Common image directories to search
        image_dirs = ['imgs', 'images', 'figures', 'figs', 'graphics', 'assets', 'img', 'figure']
        
        for filepath, latex_file in self.files.items():
            if not filepath.endswith('.tex'):
                continue
                
            resolved_graphics = []
            for graphic in latex_file.graphics:
                found = False
                
                # Try graphics paths defined in document
                for gpath in self.graphics_paths:
                    for ext in self.GRAPHICS_EXTENSIONS:
                        # Try with extension
                        full_path = self.project_dir / gpath / f"{graphic}{ext}"
                        if full_path.exists():
                            resolved_graphics.append(str(full_path))
                            found = True
                            break
                        # Try without adding extension (graphic already has extension)
                        full_path = self.project_dir / gpath / graphic
                        if full_path.exists():
                            resolved_graphics.append(str(full_path))
                            found = True
                            break
                    if found:
                        break
                
                # If not found, search in common image directories
                if not found:
                    for img_dir in image_dirs:
                        for ext in self.GRAPHICS_EXTENSIONS:
                            full_path = self.project_dir / img_dir / f"{graphic}{ext}"
                            if full_path.exists():
                                resolved_graphics.append(str(full_path))
                                found = True
                                break
                            # Try graphic with its own extension
                            full_path = self.project_dir / img_dir / graphic
                            if full_path.exists():
                                resolved_graphics.append(str(full_path))
                                found = True
                                break
                        if found:
                            break
                
                # Last resort: search entire project
                if not found:
                    for img_file in self.project_dir.rglob(graphic):
                        if img_file.suffix.lower() in self.GRAPHICS_EXTENSIONS:
                            resolved_graphics.append(str(img_file.resolve()))
                            found = True
                            break
                    # Also try base name without extension
                    if not found and '.' in graphic:
                        base_name = graphic.rsplit('.', 1)[0]
                        for img_file in self.project_dir.rglob(f"{base_name}.*"):
                            if img_file.suffix.lower() in self.GRAPHICS_EXTENSIONS:
                                resolved_graphics.append(str(img_file.resolve()))
                                found = True
                                break

            latex_file.graphics = resolved_graphics

    def _extract_metadata_from_all_content(self):
        """Re-extract metadata from combined content (handles split definitions)."""
        # Re-extract abstract if not found (might span files or be in external file)
        if not self.metadata.abstract:
            self._extract_abstract(self.all_content)

        # Re-extract authors from all content (JMLR format) - but only if main file didn't have complete info
        all_authors, all_affiliations = self._parse_jmlr_authors(self.all_content)
        # Only update if we found more authors and they're not from sample/template files
        if all_authors and len(all_authors) > len(self.metadata.authors):
            # Filter out common sample author names (names containing "Author" as placeholder)
            filtered_authors = [a for a in all_authors
                               if not (a.get('name', '').strip().lower().startswith('author') and
                                      any(word in a.get('name', '').lower() for word in ['one', 'two', 'three', 'sample']))]
            if filtered_authors:
                self.metadata.authors = filtered_authors

        if all_affiliations and not self.metadata.affiliations:
            self.metadata.affiliations = all_affiliations

        # Re-extract title from all content (only if not found in main file)
        if not self.metadata.title:
            match = self.PATTERNS['title'].search(self.all_content)
            if match:
                self.metadata.title = self._clean_latex_text(match.group(1))

    def get_dependency_tree(self) -> Dict:
        """Build a hierarchical dependency tree."""
        if not self.main_file:
            return {}

        def build_tree(filepath: str, visited: Optional[Set[str]] = None) -> Dict:
            if visited is None:
                visited = set()

            filepath = str(Path(filepath).resolve())

            if filepath in visited:
                return {'path': filepath, 'recursive': True}

            visited.add(filepath)

            latex_file = self.files.get(filepath)
            if not latex_file:
                return {'path': filepath, 'exists': False}

            node = {
                'path': filepath,
                'exists': latex_file.exists,
                'is_main': latex_file.is_main,
                'document_class': latex_file.document_class,
                'children': []
            }

            for include in latex_file.includes:
                child = build_tree(include, visited.copy())
                node['children'].append(child)

            for imp_path, imp_file in latex_file.imports:
                child = build_tree(imp_file, visited.copy())
                child['import_path'] = imp_path
                node['children'].append(child)

            return node

        return build_tree(self.main_file)

    def get_metadata_dict(self) -> Dict:
        """Get document metadata as dictionary."""
        # Deduplicate affiliations while preserving order
        seen = set()
        unique_affiliations = []
        for aff in self.metadata.affiliations:
            if aff and aff not in seen:
                seen.add(aff)
                unique_affiliations.append(aff)
        
        return {
            'title': self.metadata.title,
            'subtitle': self.metadata.subtitle,
            'authors': self.metadata.authors,
            'affiliations': unique_affiliations,
            'date': self.metadata.date,
            'abstract': self.metadata.abstract,
            'keywords': self.metadata.keywords,
            'email': self.metadata.email,
            'doi': self.metadata.doi,
        }

    def get_toc_list(self) -> List[Dict]:
        """Get table of contents as list."""
        return [entry.to_dict() for entry in self.toc_entries]

    def get_flat_list(self) -> Dict[str, List[str]]:
        """Get flat categorized list of all files."""
        result = {
            'main': [],
            'sources': [],
            'bibliography': [],
            'graphics': [],
            'packages': [],
            'custom_commands': [],
            'environments': [],
            'missing': []
        }

        seen_packages = set()
        seen_commands = set()
        seen_envs = set()

        for filepath, latex_file in self.files.items():
            if latex_file.is_main:
                result['main'].append(filepath)
            elif filepath.endswith('.bib'):
                result['bibliography'].append(filepath)
            elif filepath.endswith('.tex'):
                result['sources'].append(filepath)
            elif filepath.endswith(('.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg', '.ps')):
                result['graphics'].append(filepath)

            if not latex_file.exists:
                result['missing'].append(filepath)

            for pkg in latex_file.packages:
                if pkg not in seen_packages:
                    seen_packages.add(pkg)
                    result['packages'].append(pkg)

            for cmd in latex_file.custom_commands:
                if cmd['name'] not in seen_commands:
                    seen_commands.add(cmd['name'])
                    result['custom_commands'].append(cmd['name'])

            for env in latex_file.environments:
                if env['name'] not in seen_envs:
                    seen_envs.add(env['name'])
                    result['environments'].append(env['name'])

        # Sort all lists
        for key in result:
            if isinstance(result[key], list):
                result[key].sort()

        return result

    def get_all_related_files(self) -> List[str]:
        """Get complete list of all related files (tex, bib, images)."""
        files = []
        for filepath, latex_file in self.files.items():
            if latex_file.exists:
                files.append(filepath)
        return sorted(files)

    def get_full_report(self) -> Dict:
        """Get comprehensive analysis report."""
        return {
            'metadata': self.get_metadata_dict(),
            'document_info': {
                'main_file': self.main_file,
                'document_class': self.files.get(self.main_file, LaTeXFile(path='')).document_class,
                'document_options': self.files.get(self.main_file, LaTeXFile(path='')).document_options,
                'total_files': len(self.files),
                'total_tex_files': len([f for f in self.files if f.endswith('.tex')]),
            },
            'table_of_contents': self.get_toc_list(),
            'files': {
                'tree': self.get_dependency_tree(),
                'flat': self.get_flat_list(),
                'all_related': self.get_all_related_files(),
            },
        }


def format_tree(tree: Dict, indent: int = 0) -> str:
    """Format dependency tree as string."""
    lines = []
    rel_path = Path(tree['path']).name

    node_info = rel_path
    if tree.get('is_main'):
        node_info = f"[MAIN] {node_info}"
    if tree.get('document_class'):
        node_info += f" ({tree['document_class']})"
    if not tree.get('exists', True):
        node_info += " [MISSING]"
    if tree.get('recursive'):
        node_info += " [RECURSIVE]"

    prefix = '    ' * indent
    lines.append(f"{prefix}{'├── ' if indent > 0 else ''}{node_info}")

    children = tree.get('children', [])
    for i, child in enumerate(children):
        lines.append(format_tree(child, indent + 1))

    return '\n'.join(lines)


def format_outline(toc_entries: List[Dict], show_file: bool = False) -> str:
    """Format table of contents as outline."""
    lines = []
    indent_chars = '    '

    for entry in toc_entries:
        indent = indent_chars * entry['level']
        number = f"{entry['number']} " if entry['number'] else ""
        title = entry['title']
        
        line = f"{indent}{number}{title}"
        if show_file and entry.get('file'):
            rel_file = Path(entry['file']).name
            line += f" [{rel_file}]"
        
        lines.append(line)

    return '\n'.join(lines)


def format_metadata(metadata: Dict) -> str:
    """Format metadata for display."""
    lines = ["=== DOCUMENT METADATA ===", ""]

    if metadata.get('title'):
        lines.append(f"Title: {metadata['title']}")
    if metadata.get('subtitle'):
        lines.append(f"Subtitle: {metadata['subtitle']}")
    if metadata.get('authors'):
        authors = metadata['authors']
        # Handle both old format (list of strings) and new format (list of dicts)
        if authors and isinstance(authors[0], dict):
            for author in authors:
                name = author.get('name', '')
                email = author.get('email', '')
                affs = author.get('affiliations', [])
                if name:
                    line = f"  {name}"
                    if email:
                        line += f" <{email}>"
                    lines.append(line)
                    # Show affiliations indented under author
                    for aff in affs:
                        lines.append(f"    - {aff}")
        else:
            lines.append(f"Authors: {', '.join(authors)}")
    if metadata.get('affiliations'):
        # Deduplicate affiliations while preserving order
        seen = set()
        unique_affiliations = []
        for aff in metadata['affiliations']:
            if aff and aff not in seen:
                seen.add(aff)
                unique_affiliations.append(aff)
        
        lines.append("")
        lines.append(f"All Affiliations ({len(unique_affiliations)} total):")
        for i, aff in enumerate(unique_affiliations, 1):
            lines.append(f"  {i}. {aff}")
    if metadata.get('date'):
        lines.append(f"Date: {metadata['date']}")
    if metadata.get('keywords'):
        lines.append(f"Keywords: {', '.join(metadata['keywords'])}")
    if metadata.get('doi'):
        lines.append(f"DOI: {metadata['doi']}")

    lines.append("")
    if metadata.get('abstract'):
        lines.append("=== ABSTRACT ===")
        lines.append(metadata['abstract'])

    return '\n'.join(lines)


def format_files(flat: Dict[str, List[str]], show_full_path: bool = False) -> str:
    """Format file list for display."""
    lines = ["=== ALL RELATED FILES ===", ""]
    
    categories = [
        ('main', 'Main Document'),
        ('sources', 'Source Files (.tex)'),
        ('bibliography', 'Bibliography (.bib)'),
        ('graphics', 'Graphics Files'),
    ]
    
    for key, label in categories:
        files = flat.get(key, [])
        if files:
            lines.append(f"{label}:")
            for f in files:
                if show_full_path:
                    lines.append(f"  {f}")
                else:
                    lines.append(f"  {Path(f).name}")
            lines.append("")
    
    # Summary
    total = sum(len(flat.get(k, [])) for k in ['main', 'sources', 'bibliography', 'graphics'])
    lines.append(f"Total: {total} files")
    
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(
        description='Analyze LaTeX projects and extract structure and metadata.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s ./thesis
  %(prog)s -f metadata ./paper
  %(prog)s -f outline ./thesis
  %(prog)s -f files ./project       # List all related files (tex, bib, images)
  %(prog)s -f json -o analysis.json ./project
        """
    )
    parser.add_argument('project_dir', help='Path to LaTeX project directory')
    parser.add_argument('-m', '--main', help='Specify main .tex file')
    parser.add_argument('-f', '--format',
                        choices=['tree', 'json', 'flat', 'outline', 'metadata', 'report', 'files'],
                        default='tree', help='Output format (default: tree)')
    parser.add_argument('-o', '--output', help='Write output to file')
    parser.add_argument('-i', '--include-gen', action='store_true',
                        help='Include generated files')
    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Show detailed processing information')

    args = parser.parse_args()

    if not os.path.isdir(args.project_dir):
        print(f"Error: Directory not found: {args.project_dir}", file=sys.stderr)
        sys.exit(1)

    try:
        analyzer = LaTeXAnalyzer(
            args.project_dir,
            verbose=args.verbose,
            include_generated=args.include_gen
        )
        analyzer.analyze(args.main)

        if args.format == 'tree':
            output = format_tree(analyzer.get_dependency_tree())
        elif args.format == 'json':
            output = json.dumps(analyzer.get_dependency_tree(), indent=2)
        elif args.format == 'flat':
            flat = analyzer.get_flat_list()
            lines = []
            for category, files in flat.items():
                if files:
                    lines.append(f"\n=== {category.upper()} ===")
                    for f in files:
                        lines.append(f"  {f}")
            output = '\n'.join(lines)
        elif args.format == 'outline':
            output = format_outline(analyzer.get_toc_list(), show_file=True)
        elif args.format == 'metadata':
            output = format_metadata(analyzer.get_metadata_dict())
        elif args.format == 'report':
            output = json.dumps(analyzer.get_full_report(), indent=2)
        elif args.format == 'files':
            output = format_files(analyzer.get_flat_list(), show_full_path=True)

        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(output)
            print(f"Output written to: {args.output}")
        else:
            print(output)

        # Summary (skip for json/report formats to keep output pure)
        if args.format not in ('json', 'report'):
            print(f"\n--- Summary ---", file=sys.stderr)
            print(f"Total files: {len(analyzer.files)}", file=sys.stderr)
            if analyzer.metadata.title:
                print(f"Title: {analyzer.metadata.title}", file=sys.stderr)
            if analyzer.metadata.authors:
                # Handle both old format (list of strings) and new format (list of dicts)
                if analyzer.metadata.authors and isinstance(analyzer.metadata.authors[0], dict):
                    author_names = [a.get('name', '') for a in analyzer.metadata.authors if a.get('name')]
                else:
                    author_names = analyzer.metadata.authors
                print(f"Authors: {', '.join(author_names[:3])}{'...' if len(author_names) > 3 else ''}", file=sys.stderr)
            print(f"TOC entries: {len(analyzer.toc_entries)}", file=sys.stderr)
            missing = [f for f, lf in analyzer.files.items() if not lf.exists]
            if missing:
                print(f"Missing files: {len(missing)}", file=sys.stderr)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
