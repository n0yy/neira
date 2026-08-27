# neira-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _neira_user_zdotdir="${NEIRA_USER_ZDOTDIR:-$HOME}"
  [ -f "$_neira_user_zdotdir/.zprofile" ] && source "$_neira_user_zdotdir/.zprofile"
  unset _neira_user_zdotdir
}
:
