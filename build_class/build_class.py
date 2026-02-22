
#!/usr/bin/env python3
"""
build_class — autonomous execution kernel for larger sentient systems
planner/executor split, policy engine, sandboxed tools,
persistent semantic memory, multi-agent mesh

This module is designed to be triggered programmatically by
external systems (like sentient AI agents) without direct command execution.
"""

import os, json, time, subprocess, hashlib, re

# Load environment configuration
def get_env(key, default=None):
    """Get environment variable with optional default"""
    return os.environ.get(key, default)

def get_env_bool(key, default=False):
    """Get boolean environment variable"""
    val = os.environ.get(key, str(default)).lower()
    return val in ('true', '1', 'yes', 'on')

# Configuration from environment
WORKSPACE_DIR = get_env("WORKSPACE_DIR", "./workspace")
MEMORY_FILE = get_env("MEMORY_FILE", ".build_class.memory.json")
USE_TEST_POLICY = get_env_bool("USE_TEST_POLICY", False)
POLICY_FILE = get_env("POLICY_FILE", "policy.test.json" if USE_TEST_POLICY else "policy.json")
MAX_OUTPUT = int(get_env("MAX_OUTPUT", "4000"))
TIMEOUT = int(get_env("TIMEOUT", "20"))
MAX_MEMORY_CONTEXT = int(get_env("MAX_MEMORY_CONTEXT", "5"))

# Ensure workspace directory exists
os.makedirs(WORKSPACE_DIR, exist_ok=True)

# Set CWD to workspace
CWD = os.path.abspath(WORKSPACE_DIR)

# ---------------- Utilities ----------------

def sha(x): return hashlib.sha256(x.encode()).hexdigest()[:16]
def now(): return int(time.time())

def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

# ---------------- Policy Engine ----------------

# Default policy if file doesn't exist
default_policy = {
    "allowed_commands": get_env("ALLOWED_COMMANDS", "ls,cat,pwd,echo,grep").split(","),
    "write_enabled": get_env_bool("WRITE_ENABLED", True),
    "max_file_size": int(get_env("MAX_FILE_SIZE", "200000"))
}

policy = load_json(POLICY_FILE, default_policy)

print(f"[CONFIG] Using policy: {POLICY_FILE}")
print(f"[CONFIG] Workspace: {CWD}")
print(f"[CONFIG] Write enabled: {policy['write_enabled']}")
print(f"[CONFIG] Allowed commands: {', '.join(policy['allowed_commands'])}")

def enforce_policy(action, payload):
    if action == "bash":
        if not payload or not payload.strip():
            raise PermissionError("Empty command not allowed")
        base = payload.strip().split()[0]
        if base not in policy["allowed_commands"]:
            raise PermissionError(f"Command '{base}' denied by policy")
    if action == "write" and not policy["write_enabled"]:
        raise PermissionError("Write disabled by policy")

# ---------------- File Awareness ----------------

def classify(path):
    # Ensure path is within workspace
    abs_path = os.path.abspath(os.path.join(CWD, path))
    if not abs_path.startswith(CWD):
        raise PermissionError(f"Path '{path}' outside workspace")
    
    ext = os.path.splitext(path)[1]
    size = os.path.getsize(abs_path) if os.path.exists(abs_path) else 0
    role = "code" if ext in (".py",".js",".rs",".go") else "config" if ext in (".json",".yaml",".toml") else "data"
    return {"path": path, "ext": ext, "size": size, "role": role}

# ---------------- Tools ----------------

def tool_read(path):
    try:
        meta = classify(path)
        if meta["size"] > policy["max_file_size"]:
            return {"error": "file too large"}
        abs_path = os.path.join(CWD, path)
        with open(abs_path) as f:
            content = f.read()[:MAX_OUTPUT]
        return {"meta": meta, "content": content}
    except Exception as e:
        return {"error": str(e)}

def tool_write(path, content):
    try:
        enforce_policy("write", None)
        # Ensure path is within workspace
        abs_path = os.path.abspath(os.path.join(CWD, path))
        if not abs_path.startswith(CWD):
            raise PermissionError(f"Path '{path}' outside workspace")
        
        # Create directory if needed
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        
        with open(abs_path, "w") as f:
            f.write(content)
        return f"wrote {len(content)} bytes to {path}"
    except Exception as e:
        return {"error": str(e)}

def tool_bash(cmd):
    try:
        enforce_policy("bash", cmd)
        p = subprocess.run(
            cmd, 
            shell=True, 
            cwd=CWD, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.STDOUT, 
            timeout=TIMEOUT, 
            text=True
        )
        output = p.stdout[:MAX_OUTPUT]
        return output if output else "(no output)"
    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {TIMEOUT}s"}
    except Exception as e:
        return {"error": str(e)}

TOOLS = {"read": tool_read, "write": tool_write, "bash": tool_bash}

# ---------------- Agents ----------------

class Agent:
    def __init__(self, name, adapter, role):
        self.name = name
        self.adapter = adapter
        self.role = role

    def call(self, messages, tools=None):
        return self.adapter.call(self.role, messages, tools or [])

class Planner(Agent):
    def plan(self, goal):
        print(f"\n[PLANNER] Planning: {goal}")
        r = self.call([{"role":"user","content":goal}])
        plan = r[0]["text"] if r and len(r) > 0 else "No plan generated"
        print(f"[PLANNER] Plan created: {plan[:100]}...")
        return plan

class Executor(Agent):
    def execute(self, plan, context):
        print(f"\n[EXECUTOR] Executing plan with {len(context)} chars of context")
        result = self.call(
            [{"role":"user","content":f"Plan:\n{plan}\nContext:{context}"}], 
            list(TOOLS.keys())
        )
        print(f"[EXECUTOR] Received {len(result)} execution blocks")
        return result

class MemoryAgent(Agent):
    def summarize(self, log):
        print(f"\n[MEMORY] Summarizing execution log")
        r = self.call([{"role":"user","content":log}])
        summary = r[0]["text"] if r and len(r) > 0 else "No summary generated"
        print(f"[MEMORY] Summary: {summary[:100]}...")
        return summary

# ---------------- Mesh ----------------

class Mesh:
    def __init__(self, adapter):
        self.adapter = adapter
        self.planner = Planner("planner", adapter, "You decompose tasks into executable steps. Include the actual code in your plan.")
        self.executor = Executor("executor", adapter, """You execute plans by calling tools.
You MUST respond with a JSON object to call a tool.
For writing files: {"name": "write", "input": {"path": "filename.py", "content": "<ACTUAL CODE FROM THE PLAN>"}}
For reading files: {"name": "read", "input": {"path": "filename.py"}}
For shell commands: {"name": "bash", "input": {"cmd": "ls -la"}}
IMPORTANT: Copy the EXACT code from the plan into the content field. Do not use placeholders.
ONLY respond with valid JSON, nothing else.""")
        self.mem_agent = MemoryAgent("memory", adapter, "Summarize execution into durable memory.")
        self.memory = load_json(MEMORY_FILE, [])
        print(f"[MESH] Loaded {len(self.memory)} memory entries")

    def run(self, goal):
        print(f"\n{'='*60}")
        print(f"[MESH] Starting execution: {goal}")
        print(f"{'='*60}")
        
        # Step 1: Plan
        plan = self.planner.plan(goal)
        
        # Step 2: Execute
        context = json.dumps(self.memory[-MAX_MEMORY_CONTEXT:], indent=2)
        exec_blocks = self.executor.execute(plan, context)

        # Step 3: Run tools
        log = []
        print(f"\n[TOOLS] Executing {len(exec_blocks)} tool calls")
        
        # Check if executor didn't produce proper tool calls - fallback to extracting code from plan
        wrote_file = False
        for i, b in enumerate(exec_blocks):
            if b.get("type") == "tool_use":
                name = b.get("name")
                input_data = b.get("input", {})
                print(f"[TOOL {i+1}] {name}({input_data})")
                
                if name in TOOLS:
                    try:
                        res = TOOLS[name](**input_data)
                        print(f"[TOOL {i+1}] Result: {str(res)[:100]}...")
                        log.append({"tool": name, "input": input_data, "result": res})
                        if name == "write":
                            wrote_file = True
                    except Exception as e:
                        error = f"Error: {str(e)}"
                        print(f"[TOOL {i+1}] {error}")
                        log.append({"tool": name, "input": input_data, "error": error})
                else:
                    error = f"Unknown tool: {name}"
                    print(f"[TOOL {i+1}] {error}")
                    log.append({"tool": name, "input": input_data, "error": error})
        
        # Fallback: If no file was written but plan contains code, extract and write it
        if not wrote_file and "```" in plan:
            print("[FALLBACK] Extracting code from plan...")
            code_blocks = re.findall(r'```(?:python)?\n(.*?)```', plan, re.DOTALL)
            if code_blocks:
                # Find filename from goal
                filename_match = re.search(r'(\w+\.py)', goal)
                filename = filename_match.group(1) if filename_match else "output.py"
                
                code = code_blocks[0].strip()
                print(f"[FALLBACK] Writing {len(code)} bytes to {filename}")
                try:
                    res = tool_write(filename, code)
                    print(f"[FALLBACK] Result: {res}")
                    log.append({"tool": "write", "input": {"path": filename}, "result": res})
                except Exception as e:
                    print(f"[FALLBACK] Error: {e}")

        # Step 4: Summarize
        summary = self.mem_agent.summarize(json.dumps({"goal":goal,"plan":plan,"log":log},indent=2))
        
        # Step 5: Save memory
        entry = {"id":sha(goal+summary),"time":now(),"goal":goal,"summary":summary}
        self.memory.append(entry)
        save_json(MEMORY_FILE, self.memory)
        print(f"[MESH] Memory saved ({len(self.memory)} total entries)")
        
        print(f"{'='*60}")
        print(f"[MESH] Execution complete")
        print(f"{'='*60}\n")
        
        return plan, summary, log

# ---------------- CLI ----------------

def main(adapter):
    mesh = Mesh(adapter)
    print("\n" + "="*60)
    print("build_class ready")
    print("="*60)
    print(f"Workspace: {CWD}")
    print(f"Type 'exit' or '/q' to quit")
    print("="*60 + "\n")
    
    while True:
        try:
            g = input("❯ ").strip()
            if g in ("exit","/q"): 
                print("\nGoodbye!")
                break
            if not g:
                continue
                
            plan, summary, log = mesh.run(g)
            print("\n" + "-"*60)
            print("PLAN:")
            print("-"*60)
            print(plan)
            print("\n" + "-"*60)
            print("EXECUTION LOG:")
            print("-"*60)
            for i, entry in enumerate(log, 1):
                print(f"{i}. {entry}")
            print("\n" + "-"*60)
            print("SUMMARY:")
            print("-"*60)
            print(summary)
            print("-"*60 + "\n")
            
        except KeyboardInterrupt:
            print("\n\nInterrupted. Type 'exit' to quit.")
        except Exception as e:
            print(f"\n[ERROR] {e}")
            import traceback
            traceback.print_exc()

# ---------------- Programmatic API for External Systems ----------------

class BuildClassAPI:
    """
    Programmatic API for external sentient systems to interact with build_class.
    Allows triggering builds and operations without running commands directly.
    """
    
    def __init__(self, adapter):
        """Initialize API with an adapter"""
        self.mesh = Mesh(adapter)
        
    def execute_goal(self, goal_description):
        """
        Execute a goal programmatically.
        
        Args:
            goal_description: Natural language description of what to build/do
            
        Returns:
            dict: {
                'success': bool,
                'plan': str,
                'summary': str,
                'log': list,
                'workspace': str
            }
        """
        try:
            plan, summary, log = self.mesh.run(goal_description)
            return {
                'success': True,
                'plan': plan,
                'summary': summary,
                'log': log,
                'workspace': CWD,
                'memory_entries': len(self.mesh.memory)
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'workspace': CWD
            }
    
    def get_memory(self, limit=None):
        """Get memory entries"""
        if limit:
            return self.mesh.memory[-limit:]
        return self.mesh.memory
    
    def get_workspace_files(self):
        """Get list of files in workspace"""
        import os
        files = []
        for root, dirs, filenames in os.walk(CWD):
            for filename in filenames:
                filepath = os.path.join(root, filename)
                rel_path = os.path.relpath(filepath, CWD)
                files.append({
                    'path': rel_path,
                    'size': os.path.getsize(filepath)
                })
        return files

if __name__ == "__main__":
    raise SystemExit("Run via launcher with adapter")
