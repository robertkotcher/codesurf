"""Static Python indexing. Never imports or executes the analyzed repository."""
import ast
import builtins
import io
import json
import pathlib
import sys
import tokenize

request = json.load(sys.stdin)
roots = [pathlib.Path(p) for p in request['roots']]
files = [pathlib.Path(p) for p in request['files']]
sources, units, modules, definitions, symbol_defs, refs, diagnostics = {}, {}, {}, [], {}, {}, []


def relative(file):
    root = next(r for r in roots if file.is_relative_to(r))
    return (root.name + '/' if len(roots) > 1 else '') + file.relative_to(root).as_posix()


def utf16(text):
    return len(text.encode('utf-16-le')) // 2


def location(unit, node, attribute=False):
    line = node.end_lineno if attribute else node.lineno
    byte = node.end_col_offset - len(node.attr.encode('utf8')) if attribute else node.col_offset
    prefix = unit['lines'][line - 1].encode('utf8')[:byte].decode('utf8')
    return line, utf16(prefix)


class Scope:
    def __init__(self, unit, parent=None, class_binding=None, class_body=False):
        self.unit, self.parent, self.class_binding = unit, parent, class_binding
        self.bindings = {}
        self.class_body = class_body


def descriptor(unit, node, name, function=False):
    key = ('py:' if function else 'pysymbol:') + unit['file'] + ':' + str(node.lineno) + ':' + str(node.col_offset)
    end = node.end_lineno if function else min(node.end_lineno, node.lineno + 39)
    d = dict(id=key, name=name, file=unit['file'], absolute=str(unit['path']), start=node.lineno,
             end=end, lines=unit['lines'][node.lineno-1:end], calls=[], changed=[], language='Python')
    if function:
        definitions.append(d)
    else:
        symbol_defs[key] = d
    return d


# Register both ordinary packages and src-layout packages without importing them.
for file in files:
    key = relative(file)
    try:
        with tokenize.open(file) as stream:
            text = stream.read()
        lines = text.splitlines()
        sources[key] = lines
        tree = ast.parse(text, filename=str(file), type_comments=True)
    except (SyntaxError, UnicodeError, OSError) as error:
        diagnostics.append(f'{key}:{getattr(error, "lineno", 1)}: {error} (Python {sys.version.split()[0]})')
        continue
    root = next(r for r in roots if file.is_relative_to(r))
    parts = list(file.relative_to(root).with_suffix('').parts)
    if parts[-1] == '__init__':
        parts.pop()
    variants = [parts]
    if parts and parts[0] == 'src':
        variants.append(parts[1:])
    if (root / '__init__.py').exists():
        variants.append([root.name] + parts)
    canonical = variants[-1]
    unit = dict(path=file, file=key, lines=lines, tree=tree, root=root,
                module='.'.join(canonical), package='.'.join(canonical if file.stem == '__init__' else canonical[:-1]), scopes={})
    scope = Scope(unit)
    unit['scope'] = scope
    units[key] = unit
    refs[key] = []
    for variant in variants:
        modules.setdefault('.'.join(variant), []).append(unit)


def module_unit(name, unit):
    candidates = modules.get(name, [])
    local = [u for u in candidates if u['root'] == unit['root']]
    candidates = local or candidates
    return candidates[0] if len(candidates) == 1 else None


def bind_targets(target, value, scope):
    if isinstance(target, ast.Name):
        d = descriptor(scope.unit, target, target.id)
        scope.bindings[target.id] = dict(kind='alias', expr=value, scope=scope, descriptor=d)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for child in target.elts:
            bind_targets(child, None, scope)


def register(node, scope):
    unit = scope.unit
    unit['scopes'][id(node)] = scope
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        d = descriptor(unit, node, node.name, True)
        binding = dict(kind='function', descriptor=d)
        scope.bindings[node.name] = binding
        # A method closes over the module, not the class's namespace.
        parent = scope.parent if scope.class_body else scope
        child = Scope(unit, parent, scope.class_binding)
        unit['scopes'][id(node)] = child
        binding.update(scope=child, ast=node)
        for arg in list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs) + [a for a in (node.args.vararg, node.args.kwarg) if a]:
            child.bindings[arg.arg] = dict(kind='local', descriptor=descriptor(unit, arg, arg.arg))
        for statement in node.body:
            register(statement, child)
        return
    if isinstance(node, ast.ClassDef):
        binding = dict(kind='class', descriptor=descriptor(unit,node,node.name))
        scope.bindings[node.name] = binding
        child = Scope(unit, scope, binding, class_body=True)
        binding['scope'] = child
        unit['scopes'][id(node)] = child
        for statement in node.body:
            register(statement,child)
        return
    if isinstance(node, ast.Import):
        for alias in node.names:
            scope.bindings[alias.asname or alias.name.split('.')[0]] = dict(kind='module', module=alias.name if alias.asname else alias.name.split('.')[0])
    elif isinstance(node, ast.ImportFrom):
        package = scope.unit['package'].split('.') if scope.unit['package'] else []
        if node.level:
            package = package[:len(package) - node.level + 1]
            base = '.'.join(package + ([node.module] if node.module else []))
        else:
            base = node.module or ''
        for alias in node.names:
            if alias.name != '*':
                scope.bindings[alias.asname or alias.name] = dict(kind='import', module=base, name=alias.name)
    elif isinstance(node, (ast.Assign, ast.AnnAssign)):
        for target in node.targets if isinstance(node, ast.Assign) else [node.target]:
            bind_targets(target, node.value, scope)
    for child in ast.iter_child_nodes(node):
        register(child,scope)


for unit in units.values():
    register(unit['tree'], unit['scope'])


def lookup(name, scope):
    if name in ('self', 'cls') and scope.class_binding:
        return scope.class_binding
    while scope:
        if name in scope.bindings:
            return scope.bindings[name]
        scope = scope.parent
    return None


def resolve(binding, scope, seen=None):
    seen = set() if seen is None else seen
    if not binding or id(binding) in seen:
        return None
    seen = seen | {id(binding)}
    kind = binding['kind']
    if kind == 'import':
        unit = module_unit(binding['module'], scope.unit)
        value = unit['scope'].bindings.get(binding['name']) if unit else None
        if value:
            return resolve(value, unit['scope'], seen)
        child = module_unit(binding['module'] + '.' + binding['name'], scope.unit)
        return dict(kind='module', module=binding['module']+'.'+binding['name']) if child else binding
    if kind == 'alias':
        return expression(binding['expr'],binding['scope'],seen) or binding
    return binding


def expression(node, scope, seen=None):
    if isinstance(node, ast.Name):
        return resolve(lookup(node.id,scope),scope,seen)
    if isinstance(node, ast.Attribute):
        base = expression(node.value,scope,seen)
        if not base:
            return None
        if base['kind'] == 'module':
            unit = module_unit(base['module'],scope.unit)
            value = unit['scope'].bindings.get(node.attr) if unit else None
            if value:
                return resolve(value,unit['scope'],seen)
            return dict(kind='module',module=base['module']+'.'+node.attr)
        if base['kind'] in ('class','instance'):
            return resolve(base['scope'].bindings.get(node.attr),base['scope'],seen)
        if base['kind'] in ('import', 'external'):
            return dict(kind='external', module=base.get('module', ''), name=base.get('name', '') + '.' + node.attr)
    if isinstance(node, ast.Call):
        callee = expression(node.func,scope,seen)
        if callee and callee['kind'] == 'class':
            return dict(callee,kind='instance')
    return None


def target_of(binding, call=False):
    if not binding:
        return None
    if call and binding['kind'] == 'class':
        init = binding['scope'].bindings.get('__init__')
        return init['descriptor']['id'] if init else None
    if call and binding['kind'] != 'function':
        return None
    return binding.get('descriptor',{}).get('id')


def walk_calls(node, scope, output, root):
    if node is not root and isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef,ast.Lambda)):
        return
    if isinstance(node, ast.Call):
        binding = expression(node.func,scope)
        target = target_of(binding,True)
        attribute = isinstance(node.func,ast.Attribute)
        line,column = location(scope.unit,node.func,attribute)
        text = node.func.attr if attribute else node.func.id if isinstance(node.func,ast.Name) else ast.unparse(node.func)
        output.append(dict(target=target,label=ast.unparse(node.func),line=line,column=column,length=utf16(text),kind='resolved' if target else 'boundary'))
    for child in ast.iter_child_nodes(node):
        walk_calls(child,scope,output,root)


def collect(node, scope):
    scope = scope.unit['scopes'].get(id(node),scope)
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):
        # Only the function body executes upon a call; defaults/decorators execute at definition time.
        d = next(d for d in definitions if d['file']==scope.unit['file'] and d['start']==node.lineno)
        for statement in node.body:
            walk_calls(statement,scope,d['calls'],node)
    if isinstance(node,(ast.Name,ast.Attribute)):
        binding = expression(node,scope)
        line,column = location(scope.unit,node,isinstance(node,ast.Attribute))
        text = node.attr if isinstance(node,ast.Attribute) else node.id
        module = binding.get('module','') if binding else ('builtins' if text in vars(builtins) else '')
        refs[scope.unit['file']].append(dict(line=line,column=column,length=utf16(text),text=text,target=target_of(binding),module=module))
    for child in ast.iter_child_nodes(node):
        collect(child,scope)


for unit in units.values():
    collect(unit['tree'],unit['scope'])

json.dump(dict(definitions=definitions,sources=sources,symbolRefs=refs,symbolDefinitions=symbol_defs,diagnostics=diagnostics),sys.stdout,ensure_ascii=False)
