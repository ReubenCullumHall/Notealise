import { Icon } from '../icons'
import { Disclosure } from './Spaces'
import { OSS_LICENSES } from './ossLicenses.generated'

// Settings → General → "Open source licenses". One click deep, same pattern
// as Tutorials' index (back button + body). The list itself reuses Spaces'
// Disclosure rather than a bespoke accordion — 74 packages is too many for a
// separate screen each, so every row expands in place instead.

interface Props {
  onBack: () => void
}

export function OssLicenses({ onBack }: Props): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 rounded-lg border-none bg-transparent px-2 py-1 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <span aria-hidden="true" className="inline-flex rotate-180">
          <Icon name="chevron" className="h-3.5 w-3.5" />
        </span>
        General
      </button>

      <h3 className="mt-3 font-display text-[15px] font-semibold text-ink-900">Open source licences</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Notealise is built with the following open-source software, each under its own licence.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {OSS_LICENSES.map((pkg) => (
          <Disclosure key={pkg.name} label={pkg.name} hint={`v${pkg.version} — ${pkg.license}`}>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-ink-500">
              {pkg.licenseText ??
                `No licence file was found for this package. It is declared under the ${pkg.license} licence — see the package's own repository for the full text.`}
            </pre>
          </Disclosure>
        ))}
      </div>
    </>
  )
}
