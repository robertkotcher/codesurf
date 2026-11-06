# Parse source only; never require/load/evaluate application files.
require 'json'
require 'ripper'
require 'pathname'
class Parser < Ripper::SexpBuilderPP
  attr_reader :ranges, :errors
  def initialize(source)
    super(source)
    @ranges = {}
    @errors = []
  end
  def on_def(name, args, body)
    result = super
    @ranges[result.object_id] = [name[2][0], lineno]
    result
  end
  def on_defs(receiver, period, name, args, body)
    result = super
    @ranges[result.object_id] = [name[2][0], lineno]
    result
  end
  def on_parse_error(message)
    @errors << "#{lineno}: #{message}"
  end
end

def constant(node)
  return nil unless node.is_a?(Array)
  case node[0]
  when :@const then node[1]
  when :var_ref, :const_ref, :top_const_ref then constant(node[1])
  when :const_path_ref, :const_path_field
    [constant(node[1]),constant(node[2])].compact.join('::')
  end
end

def visit(node, &block)
  return unless node.is_a?(Array)
  yield node
  node.each { |child| visit(child, &block) if child.is_a?(Array) }
end
input = JSON.parse(STDIN.read)
roots = input['roots'].map { |r| File.realpath(r) }
definitions, sources, diagnostics, refs, internals = [], {}, [], {}, []
input['files'].each do |file|
  root = roots.find { |r| file.start_with?(r + File::SEPARATOR) }
  relative = Pathname.new(file).relative_path_from(Pathname.new(root)).to_s
  relative = File.basename(root) + '/' + relative if roots.length > 1
  begin
    text = File.binread(file)
    magic = text.lines.take(2).join.match(/(?:coding|encoding)\s*[:=]\s*([A-Za-z0-9_-]+)/)
    text.force_encoding(magic ? magic[1] : 'UTF-8')
    text = text.encode('UTF-8')
    parser = Parser.new(text)
    tree = parser.parse
    sources[relative] = text.split(/\r?\n/, -1)
    if !tree || !parser.errors.empty?
      diagnostics.concat(parser.errors.map { |e| "#{relative}:#{e} (Ruby #{RUBY_VERSION})" })
      next
    end
    walk = nil
    walk = lambda do |node, owner|
      return unless node.is_a?(Array)
      if [:class,:module].include?(node[0])
        name = constant(node[1])
        qualified = owner.empty? || name.to_s.include?('::') ? name.to_s : owner + '::' + name.to_s
        node.drop(2).each { |child| walk.call(child,qualified) }
        return
      end
      if [:def,:defs].include?(node[0])
        singleton = node[0] == :defs
        name = node[singleton ? 3 : 1]
        params = node[singleton ? 4 : 2]
        body = node[singleton ? 5 : 3]
        start, finish = parser.ranges[node.object_id]
        id = "ruby:#{relative}:#{start}:#{name[2][1]}"
        inputs = []
        parameter_list = params && params[0] == :paren ? params[1] : params
        if parameter_list && parameter_list[0] == :params
          add_input = lambda do |token, optional=false, prefix=''|
            if token.is_a?(Array) && [:@ident,:@label].include?(token[0])
              inputs << {name:prefix+token[1].sub(/:$/, ''),type:'unknown',inferred:true,optional:optional}
            end
          end
          (parameter_list[1] || []).each { |p| add_input.call(p) }
          (parameter_list[2] || []).each { |p| add_input.call(p[0],true) }
          rest = parameter_list[3]; add_input.call(rest[1],false,'*') if rest
          (parameter_list[4] || []).each { |p| add_input.call(p) }
          (parameter_list[5] || []).each { |p| add_input.call(p[0],p[1] != false) }
          rest = parameter_list[6]; add_input.call(rest[1],false,'**') if rest.is_a?(Array)
          block = parameter_list[7]; add_input.call(block[1],false,'&') if block
        end
        signature_owner = singleton && constant(node[1]) ? constant(node[1]) : owner
        definition = {id:id,name:name[1],file:relative,absolute:file,start:start,end:finish,
          lines:sources[relative][start-1..finish-1],calls:[],changed:[],language:'Ruby',
          inputs:inputs.uniq { |p| p[:name] },output:{type:'unknown',inferred:true}}
        definitions << definition
        internals << {definition:definition,owner:signature_owner,singleton:singleton,body:body}
        # Nested method definitions are indexed independently.
        walk.call(body,owner)
        return
      end
      node.each { |child| walk.call(child,owner) if child.is_a?(Array) }
    end
    walk.call(tree,'')
  rescue EncodingError, ArgumentError, SystemCallError => e
    diagnostics << "#{relative}: #{e.message}"
  end
end
internals.each do |item|
  definition = item[:definition]
  walk_calls = nil
  walk_calls = lambda do |node|
    return unless node.is_a?(Array)
    return if [:def,:defs].include?(node[0])
    token, receiver = nil, nil
    case node[0]
    when :vcall,:fcall,:command then token = node[1]
    when :call,:command_call then receiver, token = node[1], node[3]
    end
    if token.is_a?(Array) && [:@ident,:@op].include?(token[0])
      name, line, byte_column = token[1], token[2][0], token[2][1]
      explicit = constant(receiver)
      self_receiver = receiver && receiver[0] == :var_ref && receiver[1][0] == :@kw && receiver[1][1] == 'self'
      candidates = internals.select do |target|
        target[:definition][:name] == name &&
          if explicit
            target[:singleton] && ([explicit] + item[:owner].split('::').length.downto(1).map { |i| item[:owner].split('::').take(i).join('::')+'::'+explicit }).include?(target[:owner])
          elsif receiver.nil? || self_receiver
            target[:owner] == item[:owner] && target[:singleton] == item[:singleton]
          else
            false
          end
      end
      target = candidates.length == 1 ? candidates[0][:definition] : nil
      source_line = sources[definition[:file]][line-1]
      column = source_line.byteslice(0,byte_column).to_s.encode("UTF-16LE").bytesize / 2
      call = {name:name,line:line,column:column,kind:target ? 'internal' : 'boundary'}
      call[:target] = target[:id] if target
      definition[:calls] << call unless definition[:calls].any? { |c| c[:line] == line && c[:column] == column }
      if target
        (refs[definition[:file]] ||= []) << {line:line,column:column,text:name,target:target[:id]}
      end
    end
    node.each { |child| walk_calls.call(child) if child.is_a?(Array) }
  end
  walk_calls.call(item[:body])
end
puts JSON.generate({definitions:definitions,sources:sources,diagnostics:diagnostics,
  symbolRefs:refs,symbolDefinitions:definitions.map { |d| [d[:id],d] }.to_h,version:"Ripper / Ruby #{RUBY_VERSION}"})
