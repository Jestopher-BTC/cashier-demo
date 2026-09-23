/* Linear-time tokeniser for the code view. Strings and comments are consumed
   whole, so a brace or an angle bracket inside them is never mistaken for
   syntax. Returns escaped HTML. */

/* Sticky flag is a syntax error on engines that lack it, and a runtime
   SyntaxError from new RegExp when the flag is rejected. Code view must not
   take the cashier down if this file is evaluated on that engine. */
function stickyRegExp(source) {
  try {
    return new RegExp(source, "y");
  } catch (e) {
    return new RegExp(source);
  }
}

var RE_TAG = stickyRegExp("<\\/?([A-Za-z][A-Za-z0-9.]*)");
var RE_KW = stickyRegExp("(?:import|from|export|default|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|typeof|instanceof|await|async|try|catch|finally|throw|class|extends|of|in|delete|void|yield|do|null|undefined|true|false)\\b");
var RE_FN = stickyRegExp("[A-Za-z_$][\\w$]*(?=\\s*\\()");
var RE_NUM = stickyRegExp("\\d[\\d._eE+-]*");
var WORD = /[\w$]/;

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlight(src) {
  var out = [];
  var i = 0;
  var plain = 0;

  function flush(to) {
    if (to > plain) out.push(escapeHtml(src.slice(plain, to)));
  }

  while (i < src.length) {
    var ch = src[i];
    var two = ch + (src[i + 1] || "");

    if (two === "/*" || two === "//") {
      var end;
      if (two === "/*") {
        end = src.indexOf("*/", i + 2);
        end = end === -1 ? src.length : end + 2;
      } else {
        end = src.indexOf("\n", i);
        end = end === -1 ? src.length : end;
      }
      flush(i);
      out.push('<span class="c">' + escapeHtml(src.slice(i, end)) + "</span>");
      i = plain = end;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      var j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      flush(i);
      out.push('<span class="s">' + escapeHtml(src.slice(i, j)) + "</span>");
      i = plain = j;
      continue;
    }

    if (ch === "<") {
      RE_TAG.lastIndex = i;
      var tag = RE_TAG.exec(src);
      if (tag) {
        flush(i);
        out.push(escapeHtml(tag[0].slice(0, tag[0].length - tag[1].length)));
        out.push('<span class="t">' + tag[1] + "</span>");
        i = plain = i + tag[0].length;
        continue;
      }
    }

    var afterWord = i > 0 && WORD.test(src[i - 1]);
    if (!afterWord && WORD.test(ch)) {
      RE_KW.lastIndex = i;
      var kw = RE_KW.exec(src);
      if (kw) {
        flush(i);
        out.push('<span class="k">' + kw[0] + "</span>");
        i = plain = i + kw[0].length;
        continue;
      }
      RE_FN.lastIndex = i;
      var fn = RE_FN.exec(src);
      if (fn) {
        flush(i);
        out.push('<span class="f">' + fn[0] + "</span>");
        i = plain = i + fn[0].length;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        RE_NUM.lastIndex = i;
        var num = RE_NUM.exec(src);
        if (num) {
          flush(i);
          out.push('<span class="n">' + num[0] + "</span>");
          i = plain = i + num[0].length;
          continue;
        }
      }
    }
    i++;
  }
  flush(src.length);
  return out.join("");
}
