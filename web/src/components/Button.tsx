interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    variant?: "primary" | "secondary";
}

export default function Button({
    children,
    variant = "primary",
    className,
    ...props
}: ButtonProps) {
    const baseStyle =
        "px-4 py-2 rounded font-semibold focus:outline-none focus:ring-2 focus:ring-opacity-50";
    const variantStyle =
        variant === "primary"
            ? "bg-blue-500 hover:bg-blue-600 text-white focus:ring-blue-500"
            : "bg-gray-200 hover:bg-gray-300 text-gray-700 focus:ring-gray-500";

    return (
        <button
            className={`${baseStyle} ${variantStyle} ${className || ""}`}
            {...props}
        >
            {children}
        </button>
    );
}
