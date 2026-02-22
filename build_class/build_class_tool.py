#!/usr/bin/env python3
"""
BUILD_CLASS Tool Integration for GLADIUS
=========================================

This tool allows GLADIUS to trigger the BUILD_CLASS autonomous coding kernel
to construct software components, scripts, and applications.

Usage (from GLADIUS):
    build "Create a REST API server with health endpoint"
    build "Generate a data validation module"
    build "Create a simple web scraper"

Author: Artifact Virtual Systems
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

# Paths
GLADIUS_ROOT = Path(__file__).parent.parent.parent
BUILD_CLASS_ROOT = GLADIUS_ROOT / "build_class"

# Add build_class to path
sys.path.insert(0, str(BUILD_CLASS_ROOT))


def get_build_adapter():
    """Initialize the build_class adapter based on main GLADIUS .env"""
    # Load environment from main GLADIUS .env
    env_file = GLADIUS_ROOT / ".env"
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # Only set if not already set
                    if key.strip() not in os.environ:
                        os.environ[key.strip()] = value.strip()
    
    # Change to build_class directory for workspace paths
    original_cwd = os.getcwd()
    os.chdir(str(BUILD_CLASS_ROOT))
    
    adapter_type = os.environ.get("ADAPTER_TYPE", "ollama").lower()
    
    try:
        from adapter import LlamaCppAdapter, AnthropicAdapter, MockAdapter, OllamaAdapter
        
        if adapter_type == "ollama":
            adapter = OllamaAdapter()
        elif adapter_type == "llamacpp" or adapter_type == "llama":
            adapter = LlamaCppAdapter()
        elif adapter_type == "anthropic":
            adapter = AnthropicAdapter()
        elif adapter_type == "mock":
            adapter = MockAdapter()
        else:
            adapter = OllamaAdapter()  # Default to ollama
        
        os.chdir(original_cwd)
        return adapter
    except ImportError as e:
        os.chdir(original_cwd)
        raise ImportError(f"Could not import build_class adapters: {e}")


class BuildClassTool:
    """
    GLADIUS tool wrapper for BUILD_CLASS autonomous coding kernel.
    
    Allows GLADIUS to:
    - Trigger autonomous code generation
    - Build software components on demand
    - Access build history and workspace
    """
    
    def __init__(self):
        self.api = None
        self.initialized = False
        self.last_build = None
        
    def _ensure_initialized(self):
        """Lazy initialization of build_class API"""
        if not self.initialized:
            try:
                from build_class import BuildClassAPI
                adapter = get_build_adapter()
                self.api = BuildClassAPI(adapter)
                self.initialized = True
            except Exception as e:
                return {"error": f"Failed to initialize build_class: {e}"}
        return None
    
    def build(self, goal: str) -> Dict[str, Any]:
        """
        Execute a build goal using BUILD_CLASS.
        
        Args:
            goal: Natural language description of what to build
            
        Returns:
            Build result with plan, summary, log, and workspace info
        """
        init_error = self._ensure_initialized()
        if init_error:
            return init_error
        
        try:
            result = self.api.execute_goal(goal)
            self.last_build = {
                "goal": goal,
                "timestamp": datetime.now().isoformat(),
                "result": result
            }
            return result
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "goal": goal
            }
    
    def get_workspace_files(self) -> Dict[str, Any]:
        """Get list of files in build workspace"""
        init_error = self._ensure_initialized()
        if init_error:
            return init_error
            
        try:
            files = self.api.get_workspace_files()
            return {
                "success": True,
                "files": files,
                "workspace": str(BUILD_CLASS_ROOT / "workspace")
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_memory(self, limit: int = 5) -> Dict[str, Any]:
        """Get build history from memory"""
        init_error = self._ensure_initialized()
        if init_error:
            return init_error
            
        try:
            memory = self.api.get_memory(limit)
            return {
                "success": True,
                "memory": memory,
                "count": len(memory)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def read_built_file(self, path: str) -> Dict[str, Any]:
        """Read a file from the build workspace"""
        try:
            workspace = BUILD_CLASS_ROOT / "workspace"
            file_path = workspace / path
            
            if not file_path.exists():
                return {"success": False, "error": f"File not found: {path}"}
            
            if not str(file_path.resolve()).startswith(str(workspace.resolve())):
                return {"success": False, "error": "Path outside workspace"}
            
            with open(file_path) as f:
                content = f.read()
            
            return {
                "success": True,
                "path": path,
                "content": content,
                "size": len(content)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


# Global instance for tool registry
_build_tool = None

def get_build_tool() -> BuildClassTool:
    """Get or create the build tool instance"""
    global _build_tool
    if _build_tool is None:
        _build_tool = BuildClassTool()
    return _build_tool


# Tool functions for GLADIUS integration
def tool_build(goal: str) -> Dict[str, Any]:
    """
    Build software using BUILD_CLASS autonomous coding kernel.
    
    Args:
        goal: What to build (natural language description)
        
    Example:
        tool_build("Create a simple HTTP server with health endpoint")
    """
    return get_build_tool().build(goal)


def tool_build_workspace() -> Dict[str, Any]:
    """List files in the build workspace"""
    return get_build_tool().get_workspace_files()


def tool_build_memory(limit: int = 5) -> Dict[str, Any]:
    """Get recent build history"""
    return get_build_tool().get_memory(limit)


def tool_build_read(path: str) -> Dict[str, Any]:
    """Read a file from build workspace"""
    return get_build_tool().read_built_file(path)


# Export for GLADIUS tool registry
TOOLS = {
    "build": tool_build,
    "build_workspace": tool_build_workspace,
    "build_memory": tool_build_memory,
    "build_read": tool_build_read,
}


if __name__ == "__main__":
    # Test the tool
    print("Testing BUILD_CLASS tool integration...")
    
    tool = BuildClassTool()
    
    # Test workspace listing
    print("\n1. Workspace files:")
    result = tool.get_workspace_files()
    print(json.dumps(result, indent=2))
    
    # Test memory
    print("\n2. Build memory:")
    result = tool.get_memory()
    print(json.dumps(result, indent=2))
    
    print("\nBuild tool ready for GLADIUS integration.")
